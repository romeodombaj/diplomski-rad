"""
lfw_report.py
=============
Turns lfw_results.json into a table and a figure for the thesis.

The figure plots LFW 10-fold accuracy per training milestone against the
internal "separation" metric recorded in TRAINING_LOG.md. Those are two
independent ways of asking the same question -- did this epoch get better
at verification -- and the point of drawing them together is to see
whether the private metric that was used to pick the best checkpoint
agrees with the public benchmark that nobody tuned against.

USAGE: python lfw_report.py            (uses matplotlib from the base env)
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

TRAINING_SEPARATION = {
    "epoch10": 0.3456, "epoch20": 0.3976, "epoch30": 0.4601,
    "epoch40": 0.4961, "epoch50": 0.5022, "epoch60": 0.4520,
}


def main():
    with open(os.path.join(HERE, "lfw_results.json")) as fh:
        res = json.load(fh)

    print("=" * 96)
    print("LFW verification benchmark -- standard 6000-pair, 10-fold protocol")
    print("=" * 96)
    hdr = (f"{'model':20s} {'accuracy (10-fold)':>21s} {'AUC':>7s} "
           f"{'EER':>7s} {'TAR@1%':>8s} {'TAR@0.1%':>9s} {'thr':>6s} "
           f"{'oracle':>8s}")
    print(hdr)
    print("-" * 96)
    for name, r in res.items():
        print(f"{name:20s} {100*r['accuracy_mean']:12.2f}% "
              f"+/- {100*r['accuracy_stderr']:5.2f} {r['auc']:7.4f} "
              f"{100*r['eer']:6.2f}% {100*r['tar_at_far_1pct']:7.1f}% "
              f"{100*r['tar_at_far_0.1pct']:8.1f}% "
              f"{r['threshold_mean']:6.3f} {100*r['oracle_accuracy']:7.2f}%")
    print("=" * 96)
    print("thr    = mean cosine threshold chosen across the 10 folds")
    print("oracle = best threshold fitted on all 6000 pairs (test-set fitted,")
    print("         shown only to expose how much that shortcut inflates)")

    print("\nCosine similarity, LFW pairs:")
    print(f"{'model':20s} {'same':>8s} {'different':>10s} {'gap':>8s}")
    print("-" * 50)
    for name, r in res.items():
        gap = r["mean_sim_same"] - r["mean_sim_diff"]
        print(f"{name:20s} {r['mean_sim_same']:8.4f} "
              f"{r['mean_sim_diff']:10.4f} {gap:8.4f}")

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("\n(matplotlib unavailable -- table only, no figure)")
        return

    eps = [(int(n.replace("epoch", "")), n) for n in res
           if n.startswith("epoch") and n.replace("epoch", "").isdigit()]
    eps.sort()
    if not eps:
        return

    x = [e for e, _ in eps]
    acc = [100 * res[n]["accuracy_mean"] for _, n in eps]
    err = [100 * res[n]["accuracy_stderr"] for _, n in eps]
    sep = [TRAINING_SEPARATION.get(n) for _, n in eps]

    fig, ax1 = plt.subplots(figsize=(8, 5))
    h_acc = ax1.errorbar(x, acc, yerr=err, marker="o", color="#1f77b4",
                         capsize=4, linewidth=2,
                         label="LFW accuracy (10-fold)")
    handles = [h_acc]
    ax1.set_xlabel("training epoch")
    ax1.set_ylabel("LFW verification accuracy (%)", color="#1f77b4")
    ax1.tick_params(axis="y", labelcolor="#1f77b4")
    ax1.grid(alpha=0.3)

    if all(s is not None for s in sep):
        ax2 = ax1.twinx()
        h_sep, = ax2.plot(x, sep, marker="s", linestyle="--",
                          color="#d62728", linewidth=2,
                          label="training separation metric")
        handles.append(h_sep)
        ax2.set_ylabel("separation (same - different cosine)",
                       color="#d62728")
        ax2.tick_params(axis="y", labelcolor="#d62728")

    best = max(range(len(x)), key=lambda i: acc[i])
    ax1.annotate(f"best LFW: epoch {x[best]}\n{acc[best]:.2f}%",
                 xy=(x[best], acc[best]), xytext=(10, -30),
                 textcoords="offset points", fontsize=9,
                 arrowprops=dict(arrowstyle="->", alpha=0.6))

    ax1.legend(handles, [h.get_label() for h in handles],
               loc="lower right")
    plt.title("LFW verification accuracy vs. training epoch")
    plt.tight_layout()
    out = os.path.join(HERE, "lfw_accuracy_vs_epoch.png")
    plt.savefig(out, dpi=150)
    print(f"\nfigure -> {out}")


if __name__ == "__main__":
    main()
