// Public settings for the Oppo call app. Nothing secret belongs here:
// this file is served to anyone who opens the site.
export const CONFIG = Object.freeze({
  // ElevenLabs voice agent "Oppo - Operations Manager".
  agentId: 'agent_8501m5wkxarxfzhrbz4btah9k0g6',

  // WebSocket looks like normal HTTPS traffic, which is the safest bet on UAE networks.
  connectionType: 'websocket',

  // Public half of the push key pair. The private half lives with the ringer script.
  vapidPublicKey:
    'BOVYzmLM4L99027QUdT5pdxuAZojpZBpGdfxIwU2aWlWGE5ZjI8bjRDsW0ADSSTEM_k6j5oocp_-31tZE3WDr7Q',

  // Only switch on after allowing "First message" overrides on the agent in ElevenLabs.
  // When off, Oppo is told the reason for the call right after it connects instead.
  allowFirstMessageOverride: false,
});
