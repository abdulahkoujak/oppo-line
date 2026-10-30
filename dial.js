/** How much the rings grow at full volume. */
const AGENT_GAIN = 0.38;
const USER_GAIN = 0.28;

/**
 * Drives the call dial: the filled ring follows Oppo's voice, the outlined ring follows yours.
 * @param {HTMLElement} el
 * @returns {{ attach: (conversation: { getInputVolume(): number, getOutputVolume(): number }) => void, detach: () => void }}
 */
export function createDial(el) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;

  function setLevels(agent, user) {
    el.style.setProperty('--agent-level', (1 + agent * AGENT_GAIN).toFixed(3));
    el.style.setProperty('--user-level', (1 + user * USER_GAIN).toFixed(3));
  }

  function attach(conversation) {
    detach();
    if (reduceMotion.matches) return;
    const loop = () => {
      setLevels(conversation.getOutputVolume(), conversation.getInputVolume());
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
  }

  function detach() {
    window.cancelAnimationFrame(frame);
    setLevels(0, 0);
  }

  return { attach, detach };
}
