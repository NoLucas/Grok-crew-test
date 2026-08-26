# Ready-to-render sample

`npm run local` and `npm run desktop` copy the bundled clip to `local_studio/workspace/inputs/grok-crew-sample.mp4` (or the Electron `Videos/Grok Crew/inputs` workspace). On Desktop, click **Start with the sample** to open the two-cut project. No second terminal is required.

Optional: keep Local Studio running and run:

```sh
npm run sample
```

That command also records the `grok-crew-sample` bot entry and renders `local_studio/workspace/outputs/grok-crew-sample-render.mp4`. It never creates an Instagram job.

`grok-crew-sample.project.json` is the same portable project payload. It refers only to workspace-relative paths, so it is safe to inspect, adapt, or send to `python local_studio/grok_crew.py projects create --file ...` after replacing the source path with your own local media.
