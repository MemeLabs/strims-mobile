module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Reanimated 4 (used by react-native-keyboard-controller); must be last.
  plugins: ['react-native-worklets/plugin'],
};
