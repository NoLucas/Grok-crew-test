const patch = {
  schema: 'grok-crew.timeline-patch/v1',
  operations: [{ op: 'set_settings', changes: { look: 'punchy' } }],
};

setTimeout(() => {
  process.stdout.write(`${JSON.stringify({ text: JSON.stringify(patch) })}\n`);
}, 10_000);
