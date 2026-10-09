# Installing the local model

The easiest path installs the model and bridge together:

```powershell
git clone https://github.com/basel5099/ui-tars-local-control.git
cd ui-tars-local-control
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -WithModel
```

Install Node.js 22+ and the Codex CLI first. Use `-SkipMcpRegistration` for a different local MCP client. No Hugging Face token or OpenAI API key is needed for these public downloads or local inference.

## Hardware and downloads

Run `setup-model.ps1 -CheckOnly` to inspect graphics hardware and available disk space. This changes no files. For a larger drive, pass the same `-ModelRoot 'D:\Models\UI-TARS'` to setup or installation.

| Component | Pinned download | Size |
| --- | --- | --- |
| Model | UI-TARS 1.5 7B Q4_K_M GGUF | 4,777,648,512 bytes |
| Vision projector | UI-TARS 1.5 7B f16 mmproj | 1,354,162,880 bytes |
| CUDA runtime archive | llama.cpp b11527, Windows CUDA 12.4 x64 | 265,233,723 bytes |
| CUDA libraries | CUDA 12.4 runtime package | 391,443,627 bytes |
| CPU alternative | llama.cpp b11527, Windows CPU x64 | 19,520,160 bytes |

The model conversion is from [Mungert/UI-TARS-1.5-7B-GGUF](https://huggingface.co/Mungert/UI-TARS-1.5-7B-GGUF), pinned to revision `c355401ad7af0c469fe829edd3a5abd0530e35e2`. Runtime archives come from the [llama.cpp b11527 release](https://github.com/ggml-org/llama.cpp/releases/tag/b11527). SHA-256 digests and exact sizes are in [model/manifest.json](../model/manifest.json). These are downloads from their publishers; the Git repository does not contain the weights or binaries. The converted model card lists Apache-2.0; see each publisher for applicable licenses.

Allow roughly 9 GB for a fresh CUDA setup including cached archives and extraction. The tested machine uses a 12 GB NVIDIA RTX 4080 Laptop GPU with 32,768-token context. GPU detection identifies NVIDIA hardware but cannot guarantee enough VRAM or a compatible driver. CPU mode is included as a fallback and was checked for configuration only, not benchmarked. Start with at least 16 GB system RAM and expect CPU inference to be much slower.

## Separate setup and existing downloads

```powershell
.\setup-model.ps1 -ModelRoot 'D:\Models\UI-TARS' -Backend cuda -Port 8080 -Start
.\install.ps1 -ModelLauncher 'D:\Models\UI-TARS\Start-Model.ps1'
```

For a non-default port, pass the matching `-ModelBaseUrl 'http://127.0.0.1:8081/v1'` to the bridge installer. The all-in-one equivalent is `install.ps1 -WithModel -ModelPort 8081`.

To reuse downloads, specify `-ModelDirectory` containing the exact two model filenames from the manifest. `setup-model.ps1 -DownloadDirectory` chooses the runtime ZIP cache. Complete files must pass size and SHA-256 verification. Interrupted transfers stay in `.partial` files and resume when rerunning the same command. A checksum mismatch stops setup; move the bad file aside and retry after inspecting the error.

The generated `Start-Model.ps1` loads its paths from `model.config.json`, runs without a visible terminal, binds only to `127.0.0.1`, and waits until the configured model appears in `/v1/models`. The bridge invokes it automatically when the server is unavailable. It does not launch UI-TARS Desktop.

## Verify

```powershell
Invoke-RestMethod 'http://127.0.0.1:8080/v1/models'
node "$env:LOCALAPPDATA\UI-TARS-Local-Control\src\cli.mjs" health
```

Look for model ID `ui-tars-1.5-7b` and `model_ready: true`. Then use the disposable [desktop test](../test/README.md), keeping the window on the primary display. F8 stops local GUI work.

## Troubleshooting

- **Not enough disk space:** choose `-ModelRoot` or `-ModelDirectory` on a larger drive. The preflight checks each selected volume.
- **Download interrupted:** rerun the same command. Node's normal HTTPS certificate validation remains enabled; the downloader rejects redirects to HTTP. Resolve any proxy or certificate errors through normal network configuration.
- **CUDA startup fails or runs out of memory:** inspect `server.stderr.log` in the model root. Close other GPU workloads, try a smaller `-ContextSize` through `setup-model.ps1`, or choose `-Backend cpu`. CPU mode may exceed ordinary GUI task timeouts.
- **Runtime already running:** model setup avoids overwriting loaded DLLs. Stop that server first, or reuse its existing `Start-Model.ps1` with the bridge-only installer. Do not start a second server on the same port.
- **Port occupied:** select a free port; do not terminate an unrelated service. Configure the same port in the bridge endpoint.
- **Startup timeout:** inspect the model log before starting another server; the first may still be loading. The standalone launcher accepts `-TimeoutSeconds` up to 600. Cold startup also counts toward the bridge task timeout, so start the model before a benchmark.
- **Wrong model ID:** use the exact alias returned by `/v1/models` in the bridge's `model` setting.

## Validation performed

On Windows 11 x64, setup downloaded and hash-verified both CUDA archives, hash-verified the existing 6.13 GB model/projector files, extracted the runtime into a path containing spaces, and successfully launched the model. Existing weights were reused to avoid downloading another copy; a fresh 6.13 GB weight download was not repeated in this release test. Download tests cover partial resumption, ignored range requests, oversized responses, malformed ranges, and rejection of HTTP redirects. CPU inference remains untested.
