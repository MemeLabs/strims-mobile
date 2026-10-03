package com.strimsmobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.URL
import java.util.concurrent.Executors

/**
 * Turns a chat-gui emote spritesheet (frames side by side, animated on the web
 * via CSS steps()) into an animated WebP file that Fresco plays natively.
 *
 * Driving frames from JS meant a React commit per frame per emote, which kept
 * a CPU core busy. With a real animated image, playback happens on the UI
 * thread inside the image drawable, like the browser compositor does for CSS.
 *
 * Frames come from the platform encoder (`Bitmap.compress`) and are wrapped in
 * the animated-WebP RIFF container (VP8X + ANIM + one ANMF per frame) by hand,
 * so this needs no bundled native WebP library.
 */
class EmoteWebpModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  // Single thread: encodes are CPU-heavy and there's no benefit to running
  // several at once on a phone; it also keeps memory peaks bounded.
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName() = NAME

  /**
   * @param sourceUri http(s):// or file:// spritesheet
   * @param frameWidth frame width in source pixels
   * @param frameHeight frame height in source pixels
   * @param durationMs one full pass across all frames
   * @param loopCount 0 = loop forever, 1 = play once and rest on the last frame
   * @param reverse play frames last-to-first
   * @param destPath absolute output path
   * @return `file://` URI of the written file
   */
  @ReactMethod
  fun encode(
    sourceUri: String,
    frameWidth: Double,
    frameHeight: Double,
    frameCount: Double,
    durationMs: Double,
    loopCount: Double,
    reverse: Boolean,
    destPath: String,
    promise: Promise,
  ) {
    executor.execute {
      try {
        val sheet = openSource(sourceUri).use { BitmapFactory.decodeStream(it) }
          ?: throw IllegalArgumentException("could not decode $sourceUri")
        try {
          val bytes = encodeAnimated(
            sheet,
            frameWidth.toInt(),
            frameHeight.toInt(),
            frameCount.toInt(),
            durationMs,
            loopCount.toInt(),
            reverse,
          )
          val dest = File(destPath)
          dest.parentFile?.mkdirs()
          // Write-then-rename so a half-written file is never picked up.
          val tmp = File("$destPath.tmp")
          tmp.writeBytes(bytes)
          if (!tmp.renameTo(dest)) {
            throw IllegalStateException("could not move encoded emote to $destPath")
          }
          promise.resolve("file://$destPath")
        } finally {
          sheet.recycle()
        }
      } catch (e: java.io.FileNotFoundException) {
        // HttpURLConnection's 404. JS treats it as "emote index is stale".
        promise.reject("E_EMOTE_NOT_FOUND", e.message, e)
      } catch (e: Throwable) {
        promise.reject("E_EMOTE_WEBP", e.message, e)
      }
    }
  }

  private fun openSource(uri: String): InputStream =
    if (uri.startsWith("file://")) File(uri.removePrefix("file://")).inputStream() else URL(uri).openStream()

  private fun encodeAnimated(
    sheet: Bitmap,
    frameWidth: Int,
    frameHeight: Int,
    frameCount: Int,
    durationMs: Double,
    loopCount: Int,
    reverse: Boolean,
  ): ByteArray {
    require(frameWidth > 0 && frameHeight > 0 && frameCount > 0) { "bad frame geometry" }
    // A sheet may be shorter than frameCount claims; never crop past its edge.
    val available = minOf(frameCount, sheet.width / frameWidth)
    require(available > 0 && sheet.height >= frameHeight) { "spritesheet smaller than one frame" }

    // Image decoders (Fresco included, like browsers) bump frame durations
    // of <= 10ms up to 100ms, which would play very fast emotes in slow motion.
    // Keep real-time playback by skipping frames instead, as CSS steps() at a
    // 60Hz display effectively does anyway.
    val frameMs = durationMs / available
    val step = if (frameMs >= MIN_FRAME_MS) 1 else Math.ceil(MIN_FRAME_MS / frameMs).toInt()
    val order = (0 until available step step).toList().let { if (reverse) it.asReversed() else it }

    val out = ByteArrayOutputStream()
    out.write(vp8xChunk(frameWidth, frameHeight))
    out.write(chunk("ANIM", ByteArray(4) + le16(loopCount)))

    // Spread total duration over the kept frames with cumulative rounding so
    // the loop length stays exact even when per-frame ms isn't an integer.
    var emittedMs = 0L
    order.forEachIndexed { i, frame ->
      val endMs = Math.round(durationMs * (i + 1) / order.size)
      val frameDuration = (endMs - emittedMs).coerceAtLeast(1)
      emittedMs = endMs
      val bitmap = Bitmap.createBitmap(sheet, frame * frameWidth, 0, frameWidth, frameHeight)
      val imageChunks = try { stillImageChunks(bitmap) } finally { bitmap.recycle() }
      val header = le24(0) + le24(0) + le24(frameWidth - 1) + le24(frameHeight - 1) +
        le24(frameDuration.toInt()) +
        // Bit 1: don't alpha-blend onto the previous frame. Every frame is a
        // complete image, so replace the canvas. Bit 0 (dispose) unset.
        byteArrayOf(0b10)
      out.write(chunk("ANMF", header + imageChunks))
    }

    val body = out.toByteArray()
    return "RIFF".toByteArray() + le32(4 + body.size) + "WEBP".toByteArray() + body
  }

  /** Encodes one frame and returns only its image-data chunks (ALPH + VP8, or VP8L). */
  private fun stillImageChunks(bitmap: Bitmap): ByteArray {
    val buf = ByteArrayOutputStream()
    @Suppress("DEPRECATION")
    val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Bitmap.CompressFormat.WEBP_LOSSLESS
    } else {
      Bitmap.CompressFormat.WEBP
    }
    check(bitmap.compress(format, 100, buf)) { "webp compress failed" }
    val webp = buf.toByteArray()
    val kept = ByteArrayOutputStream()
    var offset = 12 // past "RIFF" <size> "WEBP"
    while (offset + 8 <= webp.size) {
      val fourcc = String(webp, offset, 4, Charsets.US_ASCII)
      val size = readLe32(webp, offset + 4)
      val total = 8 + size + (size and 1)
      // ANMF may only contain image data. The platform encoder also emits
      // VP8X and an ICCP colour profile, which are file-level chunks and make
      // the whole animation undecodable if nested in a frame.
      if (fourcc == "ALPH" || fourcc == "VP8 " || fourcc == "VP8L") {
        kept.write(webp, offset, minOf(total, webp.size - offset))
      }
      offset += total
    }
    return kept.toByteArray()
  }

  private fun vp8xChunk(width: Int, height: Int): ByteArray {
    val flags = 0x10 /* alpha */ or 0x02 /* animation */
    return chunk("VP8X", byteArrayOf(flags.toByte(), 0, 0, 0) + le24(width - 1) + le24(height - 1))
  }

  private fun chunk(fourcc: String, payload: ByteArray): ByteArray {
    val padded = if (payload.size % 2 == 1) payload + 0.toByte() else payload
    return fourcc.toByteArray(Charsets.US_ASCII) + le32(payload.size) + padded
  }

  private fun le16(v: Int) = byteArrayOf(v.toByte(), (v shr 8).toByte())
  private fun le24(v: Int) = byteArrayOf(v.toByte(), (v shr 8).toByte(), (v shr 16).toByte())
  private fun le32(v: Int) = byteArrayOf(v.toByte(), (v shr 8).toByte(), (v shr 16).toByte(), (v shr 24).toByte())
  private fun readLe32(b: ByteArray, o: Int) =
    (b[o].toInt() and 0xff) or ((b[o + 1].toInt() and 0xff) shl 8) or
      ((b[o + 2].toInt() and 0xff) shl 16) or ((b[o + 3].toInt() and 0xff) shl 24)

  companion object {
    const val NAME = "EmoteWebp"
    private const val MIN_FRAME_MS = 20.0
  }
}
