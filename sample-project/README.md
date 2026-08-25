# Ready-to-render sample

`npm run local` copies the bundled sample input into `local_studio/workspace/inputs/grok-crew-sample.mp4` on its first run. Keep the local workspace running, then open a second terminal in the repository and run:

```sh
npm run sample
```

The command creates a real two-cut project in Local Studio, records the `grok-crew-sample` bot entry, and renders `local_studio/workspace/outputs/grok-crew-sample-render.mp4`. It never creates an Instagram job.

`grok-crew-sample.project.json` is the same portable project payload used by the command. It refers only to workspace-relative paths, so it is safe to inspect, adapt, or send to `python local_studio/grok_crew.py projects create --file ...` after replacing the source path with your own local media.
