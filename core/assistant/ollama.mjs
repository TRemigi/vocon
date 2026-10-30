// Assistant: the local model endpoint. Pure; ES2017-conservative.
//
// vocon's speech-to-text is local-only, and so is the assistant's model: the endpoint must be a
// loopback address, so a config typo can't send what you said (or your window titles) to another
// machine. Only literal loopback IPs are accepted, not `localhost` (a hosts-file entry could move it).

var LOOPBACK = /^http:\/\/(127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$/;

export function isLoopbackEndpoint(endpoint) {
  return typeof endpoint === "string" && LOOPBACK.test(endpoint);
}

export function chatUrl(config) {
  return config.assistant.endpoint + "/api/chat";
}

// The Ollama /api/chat body for a `{ system, user, schema }` request. `format` makes the model's
// reply match the schema; temperature 0 keeps it repeatable. `think: "off"` is spelled false.
export function chatBody(request, config) {
  var a = config.assistant;
  return {
    model: a.model,
    stream: false,
    keep_alive: a.keepAlive,
    think: a.think === "off" ? false : a.think,
    format: request.schema,
    options: { temperature: 0, num_ctx: a.contextTokens },
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  };
}

// The model's text from a parsed /api/chat response, or "" (the model can come back empty).
export function replyText(response) {
  return response && response.message && typeof response.message.content === "string" ? response.message.content : "";
}
