# Grok Crew Runner

The Runner is installed on the machine where Grok Build is authenticated. It never receives source video or a desktop filesystem path. Its request contains an encrypted editing package made from asset IDs, timecodes, transcript text, and selected thumbnails.

```sh
node runner/grok-crew-runner.mjs init --state .runner-state --runner-id studio-runner --name "Studio Runner"
node runner/grok-crew-runner.mjs trust-desktop --state .runner-state --desktop-public desktop-public.json
node runner/grok-crew-runner.mjs run-file --state .runner-state --request request.json --output response
node runner/grok-crew-runner.mjs run-repo --state .runner-state --repo /path/to/private-relay-clone --watch --interval 5
```

`run-file` verifies the desktop Ed25519 signature, decrypts with X25519/HKDF/AES-256-GCM, runs Grok Build in streaming JSON headless mode, and writes signed encrypted events plus `result.json`. It deliberately does not use `--always-approve`; shell, write, web, and edit tools are denied, and the job uses a dedicated directory.

The preview can exchange envelopes as files or through a dedicated private Git repository. `run-repo` reads encrypted requests and signed control commands from `control`, writes signed encrypted events/results to `runner/<id>`, and can poll at a five-second interval. Cancel and pause terminate the active Grok process (or prevent it from starting) and return a signed receipt. Resume and retry keep the same Grok session ID while increasing the attempt; event sequence numbers remain monotonic across attempts. Request blob fingerprints prevent unchanged requests from being replayed.

The Runner clone must have Git credentials that can fetch `control` and push `runner/<id>`. The desktop token is never copied into the Runner state.
