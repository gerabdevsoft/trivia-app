const { expo } = require("./app.json");

const isReplitDev = process.env.REPLIT_LOCAL_DEV === "1";
const replitHost = process.env.REPLIT_DEV_DOMAIN;

module.exports = {
  ...expo,
  extra: {
    ...expo.extra,
    router: {
      ...expo.extra?.router,
      ...(isReplitDev && replitHost
        ? { headOrigin: `https://${replitHost}:5000` }
        : {}),
    },
  },
};
