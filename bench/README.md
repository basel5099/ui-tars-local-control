# Desktop task and token comparison

Tested on 2026-10-09 with a disposable Windows form. The task was identical in both conditions: **type `LOCAL CONTROL OK`, click Confirm, and verify the result**. Every successful run produced a fresh output file with exactly that text.

## Measured results

| Measurement | Direct supervising assistant | Local UI-TARS delegation |
| --- | --- | --- |
| Successful final-code trials | 1/1 | 3/3 |
| Input actions | 3 | 3, 4, 4 |
| Screenshots returned to the cloud assistant during each run | 4 | 0 |
| Local model calls | 0 | 4, 4, 5 |
| Local input tokens | 0 | 6,107 / 6,091 / 8,924 |
| Local output tokens | 0 | 303 / 281 / 398 |
| Local total tokens | 0 | **6,410 / 6,372 / 9,322** |
| Task duration, excluding server startup | Not used for comparison | 12.75 / 16.87 / 15.24 seconds |
| Cloud billed input/output tokens | **Unavailable** | **Unavailable** |
| Verification | Final screenshot + exact file contents | Exact file contents |

The median local total was **6,410 tokens**. These are measured `usage.prompt_tokens` and `usage.completion_tokens` returned by llama.cpp, summed across successful requests. They include the local model's repeated context and images. They are not paid OpenAI tokens and cannot be subtracted from a cloud token count.

The direct condition was performed by the assistant in this Codex conversation, using [direct-step.mjs](direct-step.mjs), a test-only screenshot/input harness limited to the disposable fixture. The assistant inspected an initial screenshot, clicked the input, inspected focus, typed the fixed phrase, inspected the text, clicked Confirm, and inspected the result. The built-in Computer Use helper failed to initialize, so this is a **fixture-harness baseline**, not a benchmark of that plugin. The harness executes no local model inference.

The local condition used [local.mjs](local.mjs) to call the real MCP server, select the fixture, submit one task, wait for completion, and verify its output file. The assistant received compact test results rather than the screenshot/action loop. The automated runner also saves diagnostic measurements locally; their publication here does not imply those details are normally returned by `get_status`.

## A clearly labelled image-token estimate

Actual cloud billing totals are not available from the tools used in this chat, and no separate OpenAI API benchmark was run. We therefore publish a **reference calculation for image inputs only**, based on the official [GPT-4.1 high-detail image accounting](https://developers.openai.com/api/docs/guides/images-vision#calculating-costs). This does not identify the supervising chat's model or its image encoding.

Each screenshot was 700 × 450 pixels. Under that reference rule it occupies two 512-pixel tiles: `85 + 2 × 170 = 425` image-input tokens when supplied once.

| Scenario | Reference image-input tokens |
| --- | --- |
| Direct run's four observed screenshots, counted once each | **1,700** |
| Local delegation with the file verification used in this test | **0** |
| Local delegation plus one optional final screenshot | **425** |

One final screenshot would reduce this **image-only, once-per-image reference component** by 75% versus four screenshots. Zero screenshots removes that component entirely. Neither statement is a claim of 75% or 100% savings in total tokens, subscription usage, latency, or money.

Text input, tool definitions, assistant output, reasoning, earlier conversation, repeated context, and cache discounts are excluded. The supervisor still consumes cloud tokens. Direct automation using accessibility text or dedicated application APIs can avoid screenshots too and may be more efficient than either image-based condition.

For a second, explicitly hypothetical calculation, [estimate.mjs](estimate.mjs) replays the **local loop's** recorded image appearances through the same reference formula. Trial 1 sent 1, 2, 3, and 4 images in successive local model requests: ten appearances, or **4,250 reference image-input tokens**. This is a counterfactual local-trace replay; it is not the measured direct baseline and was not run against GPT-4.1.

## Reproduce

1. Install dependencies with `npm ci`, start the local model, and compile/open [DesktopFixture.cs](../test/DesktopFixture.cs) using the [fixture instructions](../test/README.md). Use a new output filename for every trial.
2. With exactly one fixture open and the desktop unlocked, run:

   ```powershell
   node bench/local.mjs --result-file 'C:\path\to\fresh-result.txt' --output 'bench/results/my-local-trial.json'
   node bench/estimate.mjs bench/results/my-local-trial.json
   ```

3. Close and reopen a blank fixture with another fresh output path for the direct baseline. Use an assistant that can inspect local images:

   ```powershell
   node bench/direct-step.mjs observe
   # Inspect the returned screenshot before choosing coordinates.
   node bench/direct-step.mjs click X Y
   # Inspect the new screenshot and confirm the input caret/focus.
   node bench/direct-step.mjs type
   # Inspect the new screenshot, then select Confirm with fresh coordinates.
   node bench/direct-step.mjs click X Y
   # Inspect the final screenshot and verify the output file.
   node bench/report-direct.mjs 'C:\path\to\fresh-direct-result.txt' 'bench/results/my-direct-trial.json'
   ```

   `X` and `Y` are coordinates normalized to 0–1 within the most recently viewed screenshot. The harness accepts only click → fixed phrase → click, only in `DesktopFixture.exe` with the exact test window title. It refuses a changed focus/window identity or moved window. It is not a general-purpose desktop controller.

4. Compare successes first. Keep failures, model versions, screenshot sizes, action counts, model usage, and the verification method. For exact cloud token comparisons, use an instrumented cloud API run that records provider `usage` for both conditions. Do not substitute account-wide quota percentages or this long development chat's token totals.

## Artifacts and limitations

- Sanitized results: [direct trial](results/direct-trial-1.json), [local trial 1](results/local-trial-1.json), [trial 2](results/local-trial-2.json), [trial 3](results/local-trial-3.json), and [hypothetical replay estimate](results/local-loop-reference.json).
- Hardware: Windows 11 x64, NVIDIA RTX 4080 Laptop GPU with 12 GB VRAM, 2560 × 1600 desktop at approximately 150% scaling; 700 × 450 logical-pixel target crop.
- Local model: UI-TARS 1.5 7B Q4_K_M plus f16 projector, llama.cpp b11527 CUDA 12.4, 32,768-token context, temperature 0, maximum 512 output tokens per model call.
- An [initial pre-fix run](results/pre-fix-dpi-failure.json) stopped before inference because the bridge rejected slightly different horizontal/vertical DPI rounding. That bug was fixed and regression-tested before the three reported local trials.
- This is a tiny synthetic task with one direct trial. It does not establish reliability across apps or general token/cost savings. Local run variation is reported rather than selecting only the fastest or smallest result.
- Raw desktop screenshots, process IDs, file paths, and full action traces remain in ignored local storage. Published JSON contains only task-specific aggregate measurements and image dimensions.
