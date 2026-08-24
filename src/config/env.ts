// Defaults mirror chat-gui/webpack.config.js DefinePlugin values for the
// production strims.gg / chat.strims.gg deployment. Override at runtime via
// Settings if pointing the app at a different instance.

export interface StrimsConfig {
  apiUri: string;
  websocketUri: string;
  loginUri: string;
  rustlaUrl: string;
}

export const DEFAULT_CONFIG: StrimsConfig = {
  apiUri: 'https://chat.strims.gg',
  websocketUri: 'wss://chat.strims.gg/ws',
  loginUri: 'https://strims.gg/login',
  rustlaUrl: 'https://strims.gg',
};

export const JWT_COOKIE_NAME = 'jwt';
