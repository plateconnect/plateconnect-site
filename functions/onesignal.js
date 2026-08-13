const {defineSecret, defineString} = require("firebase-functions/params");

const oneSignalApiKey = defineSecret("ONESIGNAL_API_KEY");
const oneSignalAppId = defineString("ONESIGNAL_APP_ID");

/**
 * Send a push notification to a user via OneSignal external user ID.
 * Uses Firebase Auth UID as the external ID (set via OneSignal.login).
 *
 * @param {object} params
 * @param {string} params.externalUserId Firebase user ID of the recipient
 * @param {string} params.title Notification title
 * @param {string} params.body Notification body
 * @param {object} params.data Custom data payload
 * @return {Promise<object>} OneSignal API response
 */
async function sendOneSignalPush({
  externalUserId,
  title,
  body,
  data = {},
}) {
  const appId = oneSignalAppId.value();
  const apiKey = oneSignalApiKey.value();

  if (!appId) {
    throw new Error("ONESIGNAL_APP_ID is not configured");
  }

  if (!apiKey) {
    throw new Error("ONESIGNAL_API_KEY is not configured");
  }

  const payload = {
    app_id: appId,
    target_channel: "push",
    headings: {en: title},
    contents: {en: body},
    include_aliases: {
      external_id: [externalUserId],
    },
    data,
  };

  if (process.env.ONESIGNAL_ANDROID_CHANNEL_ID) {
    payload.android_channel_id = process.env.ONESIGNAL_ANDROID_CHANNEL_ID;
  } else {
    payload.existing_android_channel_id =
      process.env.ONESIGNAL_ANDROID_EXISTING_CHANNEL_ID ||
      "parent_arrival_channel";
  }

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": `Key ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    const message = result.errors ?
      JSON.stringify(result.errors) :
      JSON.stringify(result);
    throw new Error(`OneSignal API error (${response.status}): ${message}`);
  }

  return result;
}

module.exports = {
  oneSignalApiKey,
  oneSignalAppId,
  sendOneSignalPush,
};
