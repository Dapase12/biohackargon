"""Training Load: Banister TRIMP + CTL/ATL/TSB.

Ported from analytics/lib/src/onehz/clinical/load_trimp.dart.

Banister exponential TRIMP with sex-specific coefficients:
  men:   y = 0.64 * e^(1.92 * x)
  women: y = 0.86 * e^(1.67 * x)

CTL (Chronic Training Load, 42-day EWMA), ATL (Acute, 7-day EWMA),
TSB = CTL - ATL (Training Stress Balance / "form").
"""

from __future__ import annotations

import math

from argon_algorithms.models import (
    LoadState,
    Metric,
    NetTrimp,
    QuietLevel,
    Sex,
    Tier,
)
from argon_algorithms.util import mean, median, percentile_sorted, sample_cadence_seconds

# ── Constants ────────────────────────────────────────────────────────────────

# Banister 1991 weighting factor y = c * e^(b * x)
BANISTER_SCALE_MEN = 0.64
BANISTER_SCALE_WOMEN = 0.86
BANISTER_B_MEN = 1.92
BANISTER_B_WOMEN = 1.67

# Fraction of heart-rate reserve that simply BEING AWAKE costs
QUIET_WAKING_HRR = 0.20

# The most a quiet-waking level may be and still be called quiet waking
MAX_QUIET_HRR = 0.40  # ACSM's moderate-intensity floor

# Net TRIMP that defines a maximal day and maps to the top of the scale
# Calibrated: +60 min walk @105 -> strain ~2.70; +45 min run @145 -> ~8.90; +90 min hard @165 -> ~16.66
MAXIMAL_NET_TRIMP = 400.0

# Curvature of the 0-21 map (lower = steeper initial curve)
STRAIN_CURVATURE = 10.0

# %HRR at or above which a minute is EXERCISE for the strain floor
EXERCISE_FLOOR_HRR = MAX_QUIET_HRR

# Prior days needed before a personal level is used at all
QUIET_HRR_MIN_DAYS = 3

# Prior days at which the level counts as settled
QUIET_HRR_SETTLED_DAYS = 7

# Trailing window for personal baseline
QUIET_HRR_WINDOW_DAYS = 28

# Wake minutes a day needs before its own median may enter the trait series
QUIET_HRR_TRAIT_MIN_MINUTES = 360

# Minimum days of daily-TRIMP history before CTL/ATL/TSB are reported
CTL_ATL_MIN_DAYS = 14


# ── StrainScorer ─────────────────────────────────────────────────────────────


class StrainScorer:
    """StrainScorer constants + the Banister TRIMP helpers.

    Implementation of published exercise-physiology methods:
      1. Heart-Rate Reserve (Karvonen): HRR = HRmax - RHR
      2. Per-sample intensity %HRR = (HR - RHR) / HRR * 100, clamped 0..100
      3. TRIMP over the window (each sample carries its OWN duration)
    """

    # Fallback per-sample duration (minutes) - 1 s at 1 Hz
    fallback_sample_min = 1.0 / 60.0

    default_age = 30
    default_resting_hr = 60.0

    # Minimum HR samples before the observed high-percentile HRmax is trusted
    hrmax_min_samples = 600

    # Upper percentile for the observed-HRmax estimate
    hrmax_percentile = 99.5

    @staticmethod
    def banister_y(x: float, *, female: bool) -> float:
        """The sex-specific Banister weighting factor y(x).

        Single source of truth for Banister weighting in this package.
        """
        c = BANISTER_SCALE_WOMEN if female else BANISTER_SCALE_MEN
        b = BANISTER_B_WOMEN if female else BANISTER_B_MEN
        return c * math.exp(b * x)

    @staticmethod
    def tanaka_hrmax(age: float) -> float:
        """Tanaka (2001): HRmax = 208 - 0.7 * age."""
        return 208.0 - 0.7 * age

    @staticmethod
    def estimate_hrmax(hr_history: list[float], age: float | None) -> tuple[float, str]:
        """Estimate a personalized HRmax from a trailing HR series.

        Returns (hrmax bpm, source in {"observed", "tanaka", "unknown"}).
        """
        n = len(hr_history)
        tanaka = StrainScorer.tanaka_hrmax(age) if age is not None else None

        if n >= StrainScorer.hrmax_min_samples:
            sorted_hr = sorted(hr_history)
            observed = percentile_sorted(sorted_hr, StrainScorer.hrmax_percentile)
            if observed is None:
                return (0.0, 'unknown')
            if tanaka is None:
                return (observed, 'observed')
            return (observed, 'observed') if observed >= tanaka else (tanaka, 'tanaka')

        if tanaka is not None:
            return (tanaka, 'tanaka')
        return (0.0, 'unknown')

    @staticmethod
    def pct_hrr(bpm: float, resting_hr: float, hr_reserve: float) -> float:
        """Karvonen %HRR, clamped [0, 100]."""
        pct = (bpm - resting_hr) / hr_reserve * 100.0
        if pct < 0:
            return 0.0
        if pct > 100:
            return 100.0
        return pct

    @staticmethod
    def median_interval_seconds(ts_sec: list[float]) -> float | None:
        """Measured cadence (seconds) of a time-ordered stream, or None."""
        return sample_cadence_seconds(ts_sec)

    @staticmethod
    def sample_durations_minutes(ts_sec: list[float]) -> list[float]:
        """PER-SAMPLE effort durations (minutes) from the ACTUAL timestamps.

        Sample i is credited with the interval to sample i+1; the tail sample gets
        the stream's median cadence. Every interval is CAPPED at that median.
        """
        n = len(ts_sec)
        if n == 0:
            return []
        if n == 1:
            return [StrainScorer.fallback_sample_min]

        cap_sec = StrainScorer.median_interval_seconds(ts_sec)
        if cap_sec is None:
            return []

        cap_min = cap_sec / 60.0
        out = [cap_min] * n

        for i in range(n - 1):
            g = ts_sec[i + 1] - ts_sec[i]
            out[i] = (min(g, cap_sec) if g > 0 else cap_sec) / 60.0

        return out

    @staticmethod
    def banister_trimp(
        bpm: list[float],
        resting_hr: float,
        hr_reserve: float,
        durations_min: list[float],
        *,
        female: bool = False,
    ) -> float:
        """Banister exponential TRIMP: sum(duration(min) * x * y(x)), y per banister_y."""
        acc = 0.0
        for i, hr in enumerate(bpm):
            dur = durations_min[i] if i < len(durations_min) else (
                StrainScorer.fallback_sample_min if not durations_min else durations_min[-1]
            )
            x = StrainScorer.pct_hrr(hr, resting_hr, hr_reserve) / 100.0
            if x > 0:
                acc += dur * x * StrainScorer.banister_y(x, female=female)
        return acc


# ── Daily TRIMP & Quiet Waking ───────────────────────────────────────────────


def banister_trimp(
    hr_per_min: list[float],
    *,
    resting_hr: float | None,
    max_hr: float | None,
    sex: Sex,
) -> Metric[float]:
    """Banister TRIMP over a series of per-minute mean HRs.

    TRIMP = sum Δt(min) * ΔHRr * y(ΔHRr) with the published sex-specific weighting.
    """
    inputs = ['hr_per_min', 'resting_hr', 'max_hr']
    if (resting_hr is None or max_hr is None or
        not math.isfinite(resting_hr) or not math.isfinite(max_hr) or
        max_hr <= resting_hr or not hr_per_min):
        return Metric.absent(
            tier=Tier.ESTIMATE,
            inputs_used=inputs,
            note='Banister TRIMP needs finite measured RHR and HRmax (HRmax>RHR)',
        )

    reserve = max_hr - resting_hr
    trimp = 0.0
    female = sex == Sex.FEMALE

    for hr in hr_per_min:
        if not math.isfinite(hr) or hr <= 0:
            continue  # off-skin + non-finite guard
        hrr = (hr - resting_hr) / reserve
        if hrr < 0:
            hrr = 0.0
        if hrr > 1:
            hrr = 1.0
        trimp += 1.0 * hrr * StrainScorer.banister_y(hrr, female=female)

    return Metric(
        value=trimp,
        confidence=0.6,
        tier=Tier.ESTIMATE,
        inputs_used=inputs,
        note='Banister exponential TRIMP (wrist HR estimate)',
    )


def daily_quiet_waking_hrr(
    hr_per_min: list[float],
    *,
    resting_hr: float | None,
    max_hr: float | None,
    min_minutes: int = 60,
) -> float | None:
    """This user's quiet-waking level, measured: the MEDIAN per-minute HRR over a
    day's waking minutes. Percentile of self, never a population number.

    Returns None when anchors are missing, non-finite, degenerate, fewer than
    min_minutes measured waking minutes, or median > MAX_QUIET_HRR.
    """
    if (resting_hr is None or max_hr is None or
        not math.isfinite(resting_hr) or not math.isfinite(max_hr) or
        max_hr <= resting_hr):
        return None

    reserve = max_hr - resting_hr
    hrr = []
    for hr in hr_per_min:
        if math.isfinite(hr) and hr > 0:
            x = (hr - resting_hr) / reserve
            hrr.append(min(1.0, max(0.0, x)))

    if len(hrr) < min_minutes:
        return None

    q = median(hrr)
    if q is None or q <= 0 or q > MAX_QUIET_HRR:
        return None
    return q


def baseline_trimp(
    wake_minutes: float,
    *,
    quiet_hrr: float,
    female: bool = False,
) -> float:
    """The TRIMP that wake_minutes of ordinary waking accrues on its own."""
    q = min(MAX_QUIET_HRR, max(0.0, quiet_hrr))
    return wake_minutes * q * StrainScorer.banister_y(q, female=female)


def strain_from_net_trimp(net: float) -> float:
    """Map net TRIMP earned above the quiet-waking baseline onto 0-21.

    u = min(1, net / maximalNetTrimp)
    strain = 21 * ln(1 + u * (C - 1)) / ln(C), C = strainCurvature
    """
    if not math.isfinite(net) or net <= 0:
        return 0.0
    u = min(1.0, net / MAXIMAL_NET_TRIMP)
    s = 21.0 * math.log(1 + u * (STRAIN_CURVATURE - 1)) / math.log(STRAIN_CURVATURE)
    return min(21.0, max(0.0, s))


def strain_score(
    trimp: float,
    *,
    wake_minutes: float,
    quiet_hrr: float,
    female: bool = False,
) -> float:
    """Log-map the TRIMP earned above baseline into 0-21 strain score.

    LUMP FORM — CAN DEBIT EXERCISE. Use strainScoreFromSeries for guarded version.
    """
    return strain_from_net_trimp(
        trimp - baseline_trimp(wake_minutes, quiet_hrr=quiet_hrr, female=female)
    )


def _strain_estimate(
    value: float,
    *,
    inputs: list[str],
    quiet_settled: bool,
    settled_note: str,
) -> Metric[float]:
    """Present-strain envelope shared by strainScoreMetric and strainScoreFromSeries."""
    return Metric(
        value=value,
        confidence=0.6 if quiet_settled else 0.45,
        tier=Tier.ESTIMATE,
        inputs_used=inputs,
        note=settled_note if quiet_settled else (
            f'calibrating: quiet-waking level from fewer than {QUIET_HRR_SETTLED_DAYS} days'
        ),
    )


def _net_anchors_valid(
    resting_hr: float | None,
    max_hr: float | None,
    quiet_hrr: float | None,
) -> bool:
    """Whether the anchors and the quiet level can price a minute at all."""
    return (
        resting_hr is not None and max_hr is not None and quiet_hrr is not None and
        math.isfinite(resting_hr) and math.isfinite(max_hr) and math.isfinite(quiet_hrr) and
        max_hr > resting_hr and quiet_hrr > 0 and quiet_hrr <= MAX_QUIET_HRR
    )


class _NetAccumulator:
    """One pass of NetTrimp arithmetic."""

    def __init__(
        self,
        resting_hr: float,
        max_hr: float,
        quiet_hrr: float,
        sex: Sex,
    ):
        self.resting_hr = resting_hr
        self.reserve = max_hr - resting_hr
        self.female = sex == Sex.FEMALE
        self.quiet_rate = quiet_hrr * StrainScorer.banister_y(quiet_hrr, female=self.female)
        self.exercise = 0.0
        self.living = 0.0
        self.minutes = 0

    def add(self, hr: float) -> bool:
        """Adds one minute; returns False for off-skin/non-finite."""
        if not math.isfinite(hr) or hr <= 0:
            return False
        x = min(1.0, max(0.0, (hr - self.resting_hr) / self.reserve))
        e = x * StrainScorer.banister_y(x, female=self.female) - self.quiet_rate
        if x >= EXERCISE_FLOOR_HRR:
            self.exercise += e
        else:
            self.living += e
        self.minutes += 1
        return True

    @property
    def result(self) -> NetTrimp:
        return NetTrimp(exercise=self.exercise, living=self.living, minutes=self.minutes)


def net_trimp_above_quiet(
    hr_per_min: list[float],
    *,
    resting_hr: float | None,
    max_hr: float | None,
    quiet_hrr: float | None,
    sex: Sex,
) -> NetTrimp | None:
    """NetTrimp over per-minute wake HR, against this user's quiet level.

    Returns None when anchors are missing, non-finite, degenerate, quiet_hrr
    outside (0, MAX_QUIET_HRR], or no valid minute.
    """
    if not _net_anchors_valid(resting_hr, max_hr, quiet_hrr):
        return None

    acc = _NetAccumulator(resting_hr, max_hr, quiet_hrr, sex)
    for hr in hr_per_min:
        acc.add(hr)

    return acc.result if acc.minutes > 0 else None


def strain_score_metric(
    trimp: float | None,
    *,
    wake_minutes: float | None,
    quiet_hrr: float | None,
    quiet_settled: bool,
    female: bool = False,
) -> Metric[float]:
    """Headline 0-21 strain as a Metric, alongside the raw TRIMP (EST tier).

    LUMP FORM — see strain_score. The guarded entry point for rescaling a stored
    TRIMP that has no per-minute series left.
    """
    inputs = ['trimp', 'wake_minutes', 'quiet_waking_hrr']

    if trimp is None or not math.isfinite(trimp) or trimp < 0:
        return Metric.absent(
            tier=Tier.ESTIMATE,
            inputs_used=inputs,
            note='strain needs a finite TRIMP >= 0',
        )
    if wake_minutes is None or not math.isfinite(wake_minutes) or wake_minutes <= 0:
        return Metric.absent(
            tier=Tier.ESTIMATE,
            inputs_used=inputs,
            note='strain needs a finite wake window (minutes > 0) — it is what the '
                 'quiet-waking baseline is subtracted over',
        )
    if quiet_hrr is None or not math.isfinite(quiet_hrr) or quiet_hrr <= 0:
        return Metric.absent(
            tier=Tier.ESTIMATE,
            inputs_used=inputs,
            note="strain needs this user's own quiet-waking HRR to subtract, "
                 "finite and > 0; without it the cost of simply being awake reads "
                 "as training load",
        )
    if quiet_hrr > MAX_QUIET_HRR:
        return Metric.absent(
            tier=Tier.ESTIMATE,
            inputs_used=inputs,
            note=f'quiet-waking HRR above {MAX_QUIET_HRR} is not quiet waking — that '
                 "is ACSM's moderate-intensity floor, so the level would subtract "
                 "the day's own training away",
        )

    return _strain_estimate(
        strain_score(trimp, wake_minutes=wake_minutes, quiet_hrr=quiet_hrr, female=female),
        inputs=inputs,
        quiet_settled=quiet_settled,
        settled_note='headline 0-21 strain = log map of TRIMP earned above the '
                     'quiet-waking baseline; wrist-HR estimate',
    )


def strain_score_from_series(
    hr_per_min: list[float],
    *,
    resting_hr: float | None,
    max_hr: float | None,
    quiet_hrr: float | None,
    sex: Sex,
    quiet_settled: bool,
) -> Metric[float]:
    """Headline 0-21 strain from per-minute wake HR: Banister TRIMP above this
    user's quiet-waking level, exercise minutes protected (see NetTrimp).

    quiet_settled false (fewer than QUIET_HRR_SETTLED_DAYS days behind the level)
    lowers confidence and says "calibrating" — it never changes the value.
    """
    inputs = ['hr_per_min', 'resting_hr', 'max_hr', 'quiet_waking_hrr']
    n = net_trimp_above_quiet(
        hr_per_min,
        resting_hr=resting_hr,
        max_hr=max_hr,
        quiet_hrr=quiet_hrr,
        sex=sex,
    )
    if n is None:
        return Metric.absent(
            tier=Tier.ESTIMATE,
            inputs_used=inputs,
            note=f"strain needs finite RHR < HRmax, this user's own quiet-waking "
                 f"HRR in (0, {MAX_QUIET_HRR}], and at least one worn minute",
        )

    return _strain_estimate(
        strain_from_net_trimp(n.net),
        inputs=inputs,
        quiet_settled=quiet_settled,
        settled_note='Banister TRIMP above your quiet-waking level, log-mapped to 0-21',
    )


def strain_curve_from_series(
    hr_per_min: list[float],
    *,
    resting_hr: float | None,
    max_hr: float | None,
    quiet_hrr: float | None,
    sex: Sex,
) -> list[float] | None:
    """Cumulative 0-21 strain after each minute of hr_per_min (same length).

    An invalid minute repeats the previous value, 0 before the first valid one.
    NOT MONOTONE, deliberately. Living minutes net among themselves.
    """
    if not _net_anchors_valid(resting_hr, max_hr, quiet_hrr):
        return None

    acc = _NetAccumulator(resting_hr, max_hr, quiet_hrr, sex)
    out = [0.0] * len(hr_per_min)
    last = 0.0

    for i, hr in enumerate(hr_per_min):
        if acc.add(hr):
            last = strain_from_net_trimp(acc.result.net)
        out[i] = last

    return out if acc.minutes > 0 else None


def personal_quiet_waking_hrr(prior_daily_levels: list[float]) -> Metric[QuietLevel]:
    """This user's quiet-waking level: the median of the trailing
    QUIET_HRR_WINDOW_DAYS prior days' daily_quiet_waking_hrr.

    COLD START ABSTAINS. Below QUIET_HRR_MIN_DAYS valid days this is absent
    with the need_baseline grammar, never QUIET_WAKING_HRR.
    """
    inputs = ['quiet_waking_hrr_history']

    valid = [
        q for q in prior_daily_levels
        if math.isfinite(q) and q > 0 and q <= MAX_QUIET_HRR
    ]

    w = valid[-QUIET_HRR_WINDOW_DAYS:] if len(valid) > QUIET_HRR_WINDOW_DAYS else valid

    if len(w) < QUIET_HRR_MIN_DAYS:
        return Metric.absent(
            tier=Tier.ESTIMATE,
            inputs_used=inputs,
            note=f'need_baseline:have={len(w)},need={QUIET_HRR_MIN_DAYS}',
        )

    lvl = QuietLevel(hrr=median(w) or 0.0, days=len(w))
    return Metric(
        value=lvl,
        confidence=0.7 if lvl.settled else 0.4,
        tier=Tier.ESTIMATE,
        inputs_used=inputs,
        note=f'median of {len(w)} prior days of quiet waking',
    )


# ── CTL/ATL/TSB ──────────────────────────────────────────────────────────────


def ctl_atl_tsb(
    daily_trimp: list[float],
    *,
    ctl_days: float = 42.0,
    atl_days: float = 7.0,
    min_days: int = CTL_ATL_MIN_DAYS,
    prime_days: int = 7,
) -> Metric[LoadState]:
    """CTL/ATL/TSB from a time-ordered daily-TRIMP series (oldest->newest).

    EWMA with time constants 42d (CTL) and 7d (ATL): λ = 1 - e^(-1/τ).
    A missing day contributes a 0-load impulse (rest day) — the EWMA decays.

    SEEDING: ABSTAIN below min_days with the standard need_baseline note,
    and prime both accumulators with the MEAN of the first prime_days observed
    days before running the EWMA over the remainder.
    """
    inputs = ['daily_trimp']

    if len(daily_trimp) < min_days:
        return Metric.absent(
            tier=Tier.ESTIMATE,
            inputs_used=inputs,
            note=f'need_baseline:have={len(daily_trimp)},need={min_days}',
        )

    lc = 1.0 - math.exp(-1.0 / ctl_days)
    la = 1.0 - math.exp(-1.0 / atl_days)

    prime = min(max(prime_days, 1), len(daily_trimp))
    seed = mean(daily_trimp[:prime]) or 0.0

    ctl = seed
    atl = seed

    for i in range(prime, len(daily_trimp)):
        ctl = ctl + lc * (daily_trimp[i] - ctl)
        atl = atl + la * (daily_trimp[i] - atl)

    conf = max(0.3, min(0.85, len(daily_trimp) / 42.0))

    return Metric(
        value=LoadState(ctl=ctl, atl=atl, tsb=ctl - atl),
        confidence=conf,
        tier=Tier.ESTIMATE,
        inputs_used=inputs,
        note=f'Banister CTL({int(ctl_days)}d)/ATL({int(atl_days)}d)/TSB, primed from '
             f'the first {prime} observed days; descriptive load, not injury risk',
    )
