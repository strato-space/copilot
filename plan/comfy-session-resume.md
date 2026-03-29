# Comfy Session Resume

Recovered on `2026-03-29` from blocked Codex session logs for `str` / ComfyUI / LTX AV forensics.

## Main Thread

- Main session: `019c4b73-a91e-7640-9ef6-b1bf18951bb6`
- Main thread delegated three focused follow-ups:
  - `Halley`: prepare a strict upstream issue draft from current forensic facts.
  - `Pasteur`: explain the narrow `152 -> 153` transition.
  - `Peirce`: explain `/free` vs managed `comfyui.service` restart semantics.
- The main thread then hit usage limit on account `vp@iqdoctor.pro`, so no final synthesis was produced there.
- A later main-thread fact worth preserving:
  - `prompt_id a8e77d7e-938c-4ada-9e27-5b3c2c6ab6cc` (`20s HiRes`) disappeared from `queue_running`, `queue_pending`, and `history`.
  - No output file appeared.
  - Likely explanation: on shared `str`, the job was effectively displaced by a long чужая queue.

## Strongest Confirmed Facts

- There is a reproducible low-profile threshold on the same LTX AV workflow:
  - submitted `150` -> clean
  - submitted `151` -> clean
  - submitted `152` -> clean
  - submitted `153` -> full black
  - submitted `155` -> full black
  - submitted `160` -> full black
- Earlier matrix also showed:
  - submitted `125 @25fps` -> effective `121 frames`, `4.84s` -> clean
  - submitted `150 @25fps` -> effective `145 frames`, `5.80s` -> clean
  - submitted `175 @25fps` -> effective `169 frames`, `6.76s` -> black / non-finite
- High-res branch is worse:
  - `1920x1024 @ 24fps` base replay (`~7.708s`) -> full black
  - shortened high-res replay (`~3.04s`) -> still full black
  - at this point there is no confirmed safe `1920x1024` AV envelope on this stack
- Black output is not first created by `CreateVideo` / `SaveVideo`:
  - sampled frames from `VAEDecodeTiled` output were already black (`pblack:100`)
  - corruption is therefore at `VAEDecodeTiled` output or earlier
- Bad state can poison later runs, but `/free` can recover the runtime.
- `/free` is operationally asynchronous:
  - API returns before cleanup is really finished
  - `vram_free` and `torch_vram_total` return to baseline only after delayed, multi-phase settling

## Recovered Subagent Results

### Halley

- Session: `019d3173-32c1-7151-b8ae-d7cb5ef927ed`
- Produced a usable upstream issue draft:
  - title: `LTX AV: deterministic black-output threshold, delayed /free cleanup, and black frames already at VAEDecodeTiled`
- Best reusable substance from that draft:
  - ComfyUI can report `success` while producing fully black MP4
  - bad runs can poison following runs until `/free`
  - the `152 -> 153` transition looks like a bucket/alignment threshold, not gradual degradation
  - high-res remains black even when shortened
  - black frames are already present at `VAEDecodeTiled`
- If resuming with the goal of filing upstream, Halley's draft is the cleanest starting artifact.

### Pasteur

- Session: `019d3173-4348-7a61-ab14-c4ebe7e48837`
- Confirmed the narrow boundary:
  - `152` safe
  - `153` black
- Confirmed the direct localization experiment:
  - `SaveImage` attached to `VAEDecodeTiled` output showed already-black decoded frames
- Important gap:
  - Pasteur spawned another helper to explain the hidden internal reason for `152 -> 153`
  - that secondary explanation never came back into the session tail
  - so the mechanism behind `152 -> 153` is still unresolved

### Peirce

- Session: `019d3173-54bc-7133-83c3-9e2e4249c2a5`
- Strong conclusion:
  - `/free` is a signal, not a barrier
  - its observed delayed cleanup matches Comfy queue-flag behavior plus PyTorch caching allocator plus `cudaMallocAsync` pool semantics
- Strong operational conclusion:
  - `systemctl restart comfyui.service` is materially stronger than `/free`
  - restart destroys process-scoped Python/runtime/allocator/CUDA-context state that `/free` does not fully destroy
- Practical policy from this result:
  - treat `/free` as first-line reset, but always poll facts after it
  - gate on:
    - `queue_remaining == 0`
    - `vram_free` near idle baseline
    - `torch_vram_total` near idle baseline
  - if state is still poisoned, use controlled `comfyui.service` restart
  - no host reboot is needed as first response

### Kepler

- Session: `019d2fce-73d5-7e53-98cb-1416d595fe33`
- Created `server-e1t` epic family in `/home/tools/server`.
- Useful findings:
  - strongest branches were `torch.compile / graph-state poisoning` and `CUDA allocator/runtime poisoning`
  - high-res matrix harness was invalid because the supposed high-res replay ended up at `1280x704`, not true `1920x1024+`
  - created `server-e1t.7` specifically to audit true geometry/duration control nodes
- Deep research artifacts mentioned there:
  - `/tmp/ltx-subagents/software.md`
  - `/tmp/ltx-subagents/virt.md`
  - `/tmp/ltx-subagents/hardware.md`

### Boyle

- Session: `019d2fce-8b3f-7763-9ed0-dc4e226c5903`
- Created earlier parallel issue family `server-9bu`.
- Useful synthesis:
  - most likely order of causes:
    1. LTX numeric/runtime instability plus allocator poisoning
    2. `torch.compile` interaction
    3. virtualization as amplifier
    4. hardware fault
  - recommended execution order:
    1. threshold matrix
    2. `/free` / allocator semantics
    3. `torch_compile=false`

### Laplace

- Session: `019d2fce-a5c6-7660-a227-c99876579730`
- Virtualization / hardware exclusion summary:
  - environment is `kvm` with NVIDIA GPU in passthrough mode, not vGPU
  - current evidence is more consistent with software/runtime corruption than with pure hardware fault
  - hardware is not fully excluded on a non-ECC consumer card without independent memtest
- Practical criterion:
  - absence of `Xid/NVRM`, nominal `dcgmi health`, and recovery after `/free` all weaken the hardware-first hypothesis

## Current Best Hypothesis Ordering

1. `LTX` numeric/runtime instability in the AV path
2. allocator/process-state poisoning that survives bad runs
3. `torch.compile` interaction or another compiled/cached runtime-state effect
4. geometry / temporal bucketing / alignment threshold around the first internal bucket after submitted `152`
5. virtualization as amplifier, not primary cause
6. hardware fault as lower-confidence branch

## What Is Still Unresolved

- The exact internal reason for the sharp `152 -> 153` transition
- Which exact node(s) or code paths implement the hidden temporal bucket / frame quantization / alignment rule
- Whether `torch_compile=false` removes or shifts the black-output threshold
- Whether a corrected high-res harness can find any safe `1920x1024` envelope at all

## Recommended Resume Point For A New Session

Start from these steps, in this order:

1. Audit the real geometry/duration control nodes in the AV workflow.
   - This is the old `server-e1t.7` idea and is still the cleanest next move.
   - Goal: verify which nodes actually determine effective `resolution`, `frame_count`, and duration.

2. Rebuild the high-res matrix with a corrected harness.
   - Current high-res conclusions are strong enough to say "bad", but the harness history shows at least one false high-res path actually rendered at `1280x704`.

3. Run the clean discriminator:
   - bad case
   - `/free` plus polling to true idle baseline
   - retest
   - bad case again
   - `comfyui.service` restart
   - retest

4. Run the same known good/bad boundary with `torch_compile=false`.
   - Best comparison points: `152` and `153`.

5. If needed, turn Halley's draft into the actual upstream issue.

## Session IDs

- Main: `019c4b73-a91e-7640-9ef6-b1bf18951bb6`
- Kepler: `019d2fce-73d5-7e53-98cb-1416d595fe33`
- Boyle: `019d2fce-8b3f-7763-9ed0-dc4e226c5903`
- Laplace: `019d2fce-a5c6-7660-a227-c99876579730`
- Halley: `019d3173-32c1-7151-b8ae-d7cb5ef927ed`
- Pasteur: `019d3173-4348-7a61-ab14-c4ebe7e48837`
- Peirce: `019d3173-54bc-7133-83c3-9e2e4249c2a5`
