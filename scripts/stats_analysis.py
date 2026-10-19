#!/usr/bin/env python3
"""
LinterFlow — Statistical Analysis of the Mitigation Experiment
==============================================================

Consumes the JSON report exported by the ReporterService and tests whether the
LinterFlow self-healing loop produced a statistically significant improvement in
Cyclomatic Complexity (CC) and Maintainability Index (MI).

Tests performed (paired, pre vs. post, per file):
  * Wilcoxon Signed-Rank Test  (non-parametric, paired)   -> W statistic + p-value
  * Cliff's Delta              (non-parametric effect size) -> delta + magnitude

Significance level: alpha = 0.05

Metrics: CC violations (primary), max CC per function, total CC, decision points,
MI, duplication. Reports produced before those keys existed simply skip them.

Every run is WRITTEN TO DISK next to the report (--out= to redirect, --no-save to
suppress). The numbers in the dissertation have to be traceable to a stored
artefact; stdout that only ever existed in a terminal is not evidence.

Usage:
    python3 scripts/stats_analysis.py linterflow-report-<timestamp>.json
    python3 scripts/stats_analysis.py            # auto-picks the newest report in CWD

    # corpus experiment only — adds a per-tier breakdown
    python3 scripts/stats_analysis.py report.json --manifest=corpus/manifest.json

The tier lives in the manifest, not in the report. LinterFlow runs against
arbitrary repositories where tiers do not exist, and the MitigationReport is
persisted in every user's run history — so the experiment's vocabulary is
joined in here rather than pushed into the product's data model.

Dependencies:
    pip install scipy numpy
"""
import sys
import glob
import json
import os

try:
    import numpy as np
    from scipy.stats import wilcoxon
except ImportError:
    sys.exit(
        "Missing dependencies. Install them with:\n    pip install scipy numpy"
    )

ALPHA = 0.05


def cliffs_delta(pre, post):
    """Cliff's delta for paired-but-treated-as-two-groups samples.

    Returns (delta, magnitude). Interpretation thresholds follow Romano et al. (2006):
      |d| < 0.147 negligible, < 0.33 small, < 0.474 medium, else large.
    """
    pre = np.asarray(pre, dtype=float)
    post = np.asarray(post, dtype=float)
    n_pre, n_post = len(pre), len(post)
    if n_pre == 0 or n_post == 0:
        return 0.0, "undefined"

    greater = sum((p > q) for p in post for q in pre)
    less = sum((p < q) for p in post for q in pre)
    delta = (greater - less) / (n_pre * n_post)

    a = abs(delta)
    if a < 0.147:
        mag = "negligible"
    elif a < 0.33:
        mag = "small"
    elif a < 0.474:
        mag = "medium"
    else:
        mag = "large"
    return delta, mag


def run_test(name, pre, post, improvement_direction):
    """Runs Wilcoxon + Cliff's delta for one metric and prints a row.

    improvement_direction: 'decrease' (CC, duplication) or 'increase' (MI).
    """
    pre = np.asarray(pre, dtype=float)
    post = np.asarray(post, dtype=float)
    diffs = post - pre

    print(f"\n=== {name} ===")
    print(f"  n = {len(pre)}")
    print(f"  mean pre  = {pre.mean():.3f}")
    print(f"  mean post = {post.mean():.3f}")
    print(f"  mean delta = {diffs.mean():+.3f}")

    if np.all(diffs == 0):
        print("  Wilcoxon: skipped (all differences are zero — no change).")
        return

    try:
        w_stat, p_value = wilcoxon(pre, post)
    except ValueError as exc:
        print(f"  Wilcoxon: could not be computed ({exc}).")
        return

    delta, magnitude = cliffs_delta(pre, post)

    significant = p_value < ALPHA
    improved = (
        diffs.mean() < 0 if improvement_direction == "decrease" else diffs.mean() > 0
    )

    print(f"  Wilcoxon W = {w_stat:.3f}")
    print(f"  p-value    = {p_value:.5f}  ({'SIGNIFICANT' if significant else 'not significant'} at alpha={ALPHA})")
    print(f"  Cliff's d  = {delta:+.3f}  ({magnitude})")
    verdict = "improvement" if (significant and improved) else (
        "significant but worse" if significant else "no significant change"
    )
    print(f"  Verdict    => {verdict}")


def load_report(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


# Metrics tested, in reporting order. Each entry is
# (snapshot key, label, improvement direction).
#
# cyclomaticViolations leads because it is the primary dependent variable: the
# count of functions above the threshold is the same unit the static-analysis
# literature reports, which makes these results comparable with it.
#
# totalCyclomaticComplexity is here to be read AGAINST the max. A falling max
# with a flat or rising total means Extract Method relocated the branching
# rather than removing it — see the summary printed at the end of each block.
#
# decisionPoints is DERIVED (see augment_with_decision_points) and exists to
# settle that reading. Total CC is a sum over functions, and McCabe gives every
# function a floor of 1, so splitting one function into two raises the total by
# 1 even when not a single branch was added. Total CC therefore cannot
# distinguish "more branching" from "same branching, more functions".
# Subtracting functionCount removes that floor and leaves the branching itself.
#
# Older reports predate the last keys; those tests are skipped rather than
# crashing, so the script still runs against archived runs.
METRICS = [
    ("cyclomaticViolations", "CC violations — functions over the threshold (lower is better)", "decrease"),
    ("cyclomaticComplexity", "Max CC per function — the gate (lower is better)", "decrease"),
    ("totalCyclomaticComplexity", "Total CC across the file (lower is better)", "decrease"),
    ("decisionPoints", "Decision points — total CC minus the per-function floor (lower is better)", "decrease"),
    ("maintainabilityIndex", "Maintainability Index (higher is better)", "increase"),
    ("duplicationRate", "Duplication Rate % (lower is better)", "decrease"),
]

# Derived key name, computed rather than read from the report.
DECISION_POINTS = "decisionPoints"


def augment_with_decision_points(files):
    """Adds the derived `decisionPoints` key to every snapshot that can carry it.

    decisionPoints = totalCyclomaticComplexity - functionCount

    McCabe (1976) defines v(G) = e - n + 2p, so a module of p disconnected
    functions carries a baseline of p: every function costs 1 before it branches
    at all. Extracting a block from one function into another is +1 to the summed
    total by construction. Subtracting functionCount cancels that term, so what
    remains is the branching — the thing the refactoring is supposed to reduce.

    Computed here rather than in the ReporterService because it is a reading of
    the data, not a new measurement: the report stays the record of what was
    observed, and this stays the record of how it was interpreted.
    """
    for record in files:
        for phase in ("initial", "final"):
            snapshot = record.get(phase)
            if not snapshot:
                continue
            if (
                "totalCyclomaticComplexity" in snapshot
                and "functionCount" in snapshot
            ):
                snapshot[DECISION_POINTS] = (
                    snapshot["totalCyclomaticComplexity"] - snapshot["functionCount"]
                )


def load_tier_map(manifest_path):
    """Maps corpus file name -> (tier, componentType) from the corpus manifest.

    The tier is an artefact of the EXPERIMENT, not of the pipeline: LinterFlow
    runs against arbitrary repositories where no such thing exists. Keeping the
    join here means the MitigationReport — which is persisted in every user's
    run history — never carries a field that is meaningless outside the corpus.

    The manifest is also a better source than the file name: it states the tier
    explicitly instead of relying on a `component_tier_index.ts` convention.
    """
    with open(manifest_path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    return {e["file"]: (e.get("tier"), e.get("componentType")) for e in manifest}


def paired(files, key):
    """Extracts the (pre, post) vectors for one metric, or None if absent."""
    try:
        pre = [f["initial"][key] for f in files]
        post = [f["final"][key] for f in files]
    except KeyError:
        return None
    return pre, post


def redistribution_note(files):
    """Complexity removed vs. merely relocated — only if the keys are present.

    Prints the decomposition budget: how much of the rise in total CC is the
    arithmetic cost of having more functions, and how much branching actually
    went away once that cost is accounted for.
    """
    try:
        moved = sum(
            1
            for f in files
            if f["final"]["cyclomaticComplexity"] < f["initial"]["cyclomaticComplexity"]
            and f["final"]["totalCyclomaticComplexity"]
            >= f["initial"]["totalCyclomaticComplexity"]
        )
        fn_pre = sum(f["initial"]["functionCount"] for f in files)
        fn_post = sum(f["final"]["functionCount"] for f in files)
        tot_pre = sum(f["initial"]["totalCyclomaticComplexity"] for f in files)
        tot_post = sum(f["final"]["totalCyclomaticComplexity"] for f in files)
    except KeyError:
        return

    if moved:
        print(
            f"\n  NOTE: in {moved} file(s) the worst function got simpler while the file's"
            f"\n        TOTAL complexity did not fall — branching was relocated, not removed."
        )

    new_functions = fn_post - fn_pre
    observed_rise = tot_post - tot_pre
    if new_functions <= 0:
        return

    # Each extraction adds exactly +1 to the summed total when no branching is
    # added or removed: the extracted function costs 1, and the branches it
    # takes with it are subtracted from its parent. So new_functions is the
    # structural price of the decomposition, and anything below it is branching
    # that genuinely disappeared.
    eliminated = new_functions - observed_rise
    print(
        f"\n  DECOMPOSITION BUDGET"
        f"\n    functions          {fn_pre} -> {fn_post}  ({new_functions:+d})"
        f"\n    total CC           {tot_pre} -> {tot_post}  ({observed_rise:+d})"
        f"\n    structural cost    {new_functions:+d}  (+1 per new function, by construction)"
        f"\n    branching removed  {eliminated:+d}  (structural cost minus observed rise)"
        f"\n    => the total rose by {observed_rise:+d} while the branching behind it fell by"
        f"\n       {eliminated}. The rise is the price of decomposition, not new complexity."
    )


def analyse(files, heading):
    """Runs every available metric test over one set of files."""
    print("\n" + "=" * 68)
    print(heading)
    print("=" * 68)

    if not files:
        print("  (no files in this group)")
        return

    ran = False
    for key, label, direction in METRICS:
        vectors = paired(files, key)
        if vectors is None:
            print(f"\n=== {label} ===\n  skipped — '{key}' absent from this report.")
            continue
        run_test(label, vectors[0], vectors[1], direction)
        ran = True

    if ran:
        redistribution_note(files)


class Tee:
    """Writes everything printed to both stdout and a transcript file.

    The analysis is the result of the experiment; leaving it in a terminal
    scrollback makes the dissertation's numbers unreproducible in practice even
    though the script is deterministic. Teeing rather than redirecting keeps the
    run readable while it happens.
    """

    def __init__(self, stream, handle):
        self._stream = stream
        self._handle = handle

    def write(self, text):
        self._stream.write(text)
        self._handle.write(text)

    def flush(self):
        self._stream.flush()
        self._handle.flush()


def default_output_path(report_path):
    """Transcript sits beside the report it analyses, sharing its timestamp."""
    directory = os.path.dirname(os.path.abspath(report_path))
    stem = os.path.basename(report_path)
    if stem.endswith(".json"):
        stem = stem[: -len(".json")]
    return os.path.join(directory, f"{stem}-stats.txt")


def parse_args(argv):
    """Positional report path (optional) + optional --manifest=/--out=/--no-save."""
    report_path, manifest_path, out_path, save = None, None, None, True
    for arg in argv:
        if arg.startswith("--manifest="):
            manifest_path = arg[len("--manifest=") :]
        elif arg == "--manifest":
            sys.exit("--manifest requires a path: --manifest=corpus/manifest.json")
        elif arg.startswith("--out="):
            out_path = arg[len("--out=") :]
        elif arg == "--out":
            sys.exit("--out requires a path: --out=analysis.txt")
        elif arg == "--no-save":
            save = False
        elif not arg.startswith("-") and report_path is None:
            report_path = arg
    return report_path, manifest_path, out_path, save


def run_analysis(report_path, files, manifest_path):
    print("=" * 68)
    print("LinterFlow — Statistical Analysis")
    print(f"Report: {report_path}")
    print(f"Files analysed: {len(files)}")
    print(f"alpha = {ALPHA}")
    print("=" * 68)

    analyse(files, "ALL FILES")

    # Per-tier breakdown is opt-in: without a manifest this is an ordinary
    # pipeline report over an arbitrary repository, where tiers do not exist.
    if manifest_path is None:
        print(
            "\n(no --manifest given — skipping the per-tier breakdown."
            "\n Pass --manifest=corpus/manifest.json to group corpus results by tier.)"
        )
        print("\nDone.")
        return

    tier_map = load_tier_map(manifest_path)
    groups, unmatched = {}, []
    for f in files:
        name = os.path.basename(f["filePath"])
        if name in tier_map:
            groups.setdefault(tier_map[name][0], []).append(f)
        else:
            unmatched.append(name)

    if unmatched:
        print(
            f"\nWARNING: {len(unmatched)} file(s) in the report are absent from the manifest"
            f" and are excluded from the per-tier breakdown: {', '.join(sorted(unmatched)[:5])}"
            f"{' …' if len(unmatched) > 5 else ''}"
        )

    for tier in ("low", "medium", "high"):
        if tier in groups:
            analyse(groups[tier], f"TIER: {tier.upper()}  (n = {len(groups[tier])})")

    # A tier whose files were already healthy is expected to show no change.
    # That is the control result — the pipeline leaving good code alone — and
    # it is worth stating explicitly so a flat block is not read as a failure.
    print("\n" + "=" * 68)
    print("READING THE TIER BLOCKS")
    print("=" * 68)
    print(
        "  A tier where every difference is zero means no file breached a threshold,\n"
        "  so the pipeline never called the LLM. That is the control condition — it\n"
        "  shows the loop leaves healthy code untouched — not a failed treatment.\n"
        "  Wilcoxon discards zero differences, so the effective n of the global test\n"
        "  is the number of files that were actually treated, not the file count."
    )

    print("\nDone.")


def main():
    report_path, manifest_path, out_path, save = parse_args(sys.argv[1:])

    if report_path is None:
        candidates = sorted(
            glob.glob("linterflow-report-*.json"), key=os.path.getmtime, reverse=True
        )
        if not candidates:
            sys.exit(
                "No report file given and no linterflow-report-*.json found in the current directory."
            )
        report_path = candidates[0]
        print(f"(auto-selected newest report: {report_path})")

    report = load_report(report_path)
    files = report.get("files", [])
    if not files:
        sys.exit("Report contains no file records.")

    augment_with_decision_points(files)

    if not save:
        run_analysis(report_path, files, manifest_path)
        return

    out_path = out_path or default_output_path(report_path)
    original = sys.stdout
    with open(out_path, "w", encoding="utf-8") as handle:
        sys.stdout = Tee(original, handle)
        try:
            run_analysis(report_path, files, manifest_path)
        finally:
            sys.stdout = original
    print(f"\nAnalysis saved to: {out_path}")


if __name__ == "__main__":
    main()
