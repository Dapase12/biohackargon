# Phase 6: Frontend Integration + Production Deploy

## Overview
This document describes the Phase 6 implementation for the Argon biohacking platform, adding:
1. Supabase Edge Functions for webhook handling
2. Frontend sleep staging dashboard components
3. CI/CD pipeline
4. Deployment documentation

---

## 1. Supabase Edge Functions

### Sleep Staging Webhook (`/functions/v1/sleep-webhook`)

**Endpoint**: `POST https://<project-ref>.supabase.co/functions/v1/sleep-webhook`

**Authentication**: Bearer token (Supabase JWT)

**Payload**:
```json
{
  "user_id": "uuid",
  "log_date": "2024-01-15",
  "accel": [{"ts_ms": 1234567890000, "x": 0.0, "y": 0.0, "z": 1.0, "valid": true}, ...],
  "hr": [{"ts_ms": 1234567890000, "hr": 55}, ...],
  "rr": [{"ts_ms": [1234567890000, ...], "rr_ms": [1000, 1010, ...]}, ...],
  "in_bed_start_s": 1234567890,
  "in_bed_end_s": 1234597890,
  "config": {"epoch_sec": 30}
}
```

**Processing**: Calls Python pipeline service (via `PYTHON_PIPELINE_URL` env var) or stores raw data structure.

**Response**:
```json
{
  "success": true,
  "data": {
    "segmentation": {...},
    "features": [...],
    "observation": {...},
    "profile": {...},
    "stored": true,
    "error": null
  }
}
```

### Strain/TRIMP Webhook (`/functions/v1/strain-webhook`)

**Endpoint**: `POST https://<project-ref>.supabase.co/functions/v1/strain-webhook`

**Authentication**: Bearer token (Supabase JWT)

**Payload**:
```json
{
  "user_id": "uuid",
  "log_date": "2024-01-15",
  "hr_per_min": [120, 130, 145, ...],
  "resting_hr": 55,
  "max_hr": 190,
  "sex": "M",
  "wake_minutes": 960,
  "quiet_hrr": 0.35,
  "exercise_type": "running"
}
```

**Processing**: Computes Banister TRIMP, CTL/ATL/TSB, strain score (0-21), recommended max strain.

**Response**:
```json
{
  "success": true,
  "data": {
    "trimp": 45.2,
    "net_trimp": 12.5,
    "net_above_quiet": 12.5,
    "strain_score": 7.8,
    "ctl": 42.1,
    "atl": 28.3,
    "tsb": 13.8,
    "quiet_hrr": 0.35,
    "baseline_trimp": 120.5,
    "recommended_max_strain": 10
  }
}
```

### Deployment
```bash
# Set secrets
supabase secrets set PYTHON_PIPELINE_URL="https://your-python-service.com" --project-ref <ref>

# Deploy functions
supabase functions deploy sleep-webhook --project-ref <ref>
supabase functions deploy strain-webhook --project-ref <ref>
```

---

## 2. Frontend Sleep Staging Dashboard

### New JavaScript Module: `argon-sleep.js`

**Features**:
- **Hypnogram**: Sleep stage timeline (Wake/NREM/REM) with deep sleep highlighting
- **Sleep Scores**: TST, efficiency, SWS%, REM%, light%, debt, latency
- **HRV Trends**: 30-day lnRMSSD, LF/HF, RK trends (ApexCharts)
- **Epoch Charts**: Per-epoch HR, RMSSD, ENMO with stage background coloring
- **Profile Baselines**: Personal sleep profile (14-night rolling baselines)
- **Architecture Trends**: 30-day TST, efficiency, SWS%, REM%, debt

### Integration
```html
<!-- Add to index.html before </body> -->
<script src="argon-sleep.js"></script>
```

### Container Elements (in Sleep Tab)
```html
<div id="sleep-hypnogram" class="min-h-[120px]"></div>
<div id="sleep-scores" class="space-y-2"></div>
<div id="sleep-epoch-charts" class="w-full min-h-[320px]"></div>
<div id="sleep-hrv-trends" class="w-full min-h-[280px]"></div>
<div id="sleep-profile-baselines" class="space-y-2"></div>
<div id="sleep-trend-charts" class="w-full min-h-[300px]"></div>
```

### Data Sources
Queries Supabase tables:
- `sleep_segmentations` - hypnogram stages, sleep onset/offset
- `sleep_epoch_features` - per-epoch HR, HRV, movement, stage
- `sleep_night_observations` - nightly HRV baselines
- `sleep_user_profiles` - rolling personal baselines
- `sleep_daily_scores` (view) - computed daily metrics

### Auto-loading
- Loads when sleep tab (index 1) is selected
- Reloads when date changes via `loadDayData()`
- Reloads after Supabase sync

---

## 3. CI/CD Pipeline

### GitHub Actions Workflows

#### `.github/workflows/ci.yml`
- **python-tests**: Lint (ruff), type-check (mypy), tests with 80% coverage
- **edge-functions-lint**: Deno lint and format check
- **deploy-edge-functions**: Deploys Edge Functions on main branch push
- **deploy-pages**: Existing GitHub Pages deployment

### Required Secrets
| Secret | Description |
|--------|-------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI access token |
| `SUPABASE_PROJECT_REF` | Supabase project reference |
| `PYTHON_PIPELINE_URL` | URL for Python pipeline service |

### Local Development
```bash
# Start Supabase local
supabase start

# Deploy functions locally
supabase functions deploy sleep-webhook --local
supabase functions deploy strain-webhook --local

# Run Python tests
cd python
pytest tests/ validation/ -v --cov=argon_algorithms --cov-fail-under=80
```

---

## 4. Database Schema

### Tables (from `sql/sleep_staging_schema.sql`)
- `sleep_segmentations` - Main sleep staging results
- `sleep_epoch_features` - Per-epoch cardio features
- `sleep_user_profiles` - Rolling personal baselines (EWMA)
- `sleep_night_observations` - Nightly observations for profile folding
- `sleep_daily_scores` (view) - Computed daily sleep metrics

### RLS Policies
All tables have Row Level Security enabling users to only access their own data.

### Migration
```sql
-- Run in Supabase SQL Editor
\i sql/sleep_staging_schema.sql
\i sql/expand_computed_daily_scores.sql
```

---

## 5. Architecture Overview

```
Health Connect (Android)
    ↓
Google Apps Script (Webhook)
    ↓
Supabase Edge Function (sleep-webhook / strain-webhook)
    ↓
Python Pipeline Service (optional, for heavy compute)
    ↓
Supabase Database (sleep_segmentations, sleep_epoch_features, etc.)
    ↓
Frontend (GitHub Pages) ← argon-sleep.js queries Supabase directly
```

### Data Flow
1. Amazfit Bip 6 / Health Connect collects 1 Hz data (accel, HR, RR)
2. Google Apps Script forwards to Supabase Edge Function
3. Edge Function validates JWT, calls Python pipeline
4. Results stored in sleep staging tables
5. Frontend queries Supabase directly (anon key) for visualization
6. User sees hypnogram, HRV trends, sleep scores in real-time

---

## 6. Configuration

### Environment Variables (Supabase Edge Functions)
| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_ANON_KEY` | Yes | Anon public key |
| `PYTHON_PIPELINE_URL` | No | Python service for heavy compute |

### Frontend Config (`config.js`)
```javascript
window.CONFIG = {
  supabase: {
    url: 'https://<project>.supabase.co',
    anonKey: '<anon-key>'
  },
  profile: {
    timezone: 'America/Caracas',
    birthDate: '1990-01-01',
    heightM: 1.75,
    // ...
  }
}
```

### User Settings (localStorage)
- `argon_sb_url` - Supabase URL (overrides config.js)
- `argon_sb_key` - Supabase anon key (overrides config.js)
- `argon_accent` - UI accent color

---

## 7. Testing

### Python Validation
```bash
cd python
# Run all validation tests
python -m validation.run_validation

# Run unit tests
pytest tests/ -v --cov=argon_algorithms --cov-fail-under=80

# Run validation harness only
python -m validation.run_validation 2>&1 | grep -E "(PASS|FAIL|SKIP)"
```

### Frontend Testing
```bash
# Syntax check
node --check index.html
node --check argon-mbe.js
node --check argon-sleep.js
node --check simulate-recovery.js

# Run in browser
# Open index.html with live server
```

### Edge Function Testing
```bash
# Local invoke
supabase functions serve sleep-webhook --local

# Test with curl
curl -X POST http://localhost:54327/functions/v1/sleep-webhook \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test","log_date":"2024-01-15","accel":[],"hr":[],"rr":[],"in_bed_start_s":0,"in_bed_end_s":3600}'
```

---

## 8. Monitoring & Debugging

### Supabase Logs
```bash
# View function logs
supabase functions logs sleep-webhook --project-ref <ref>

# View database logs
supabase logs --project-ref <ref>
```

### Frontend Debug
- Open browser DevTools → Console
- Check Network tab for Supabase queries
- Verify ApexCharts loads correctly
- Check localStorage for `argon_sb_url` and `argon_sb_key`

### Common Issues
| Issue | Solution |
|-------|----------|
| "Falta Anon Key" | Set `argon_sb_key` in Settings modal |
| ApexCharts not rendering | Ensure `apexcharts` CDN loads before `argon-sleep.js` |
| No sleep data | Verify webhook is receiving data, check `sleep_segmentations` table |
| CORS errors | Check Edge Function CORS headers match frontend origin |

---

## 9. Future Enhancements

### Phase 6.1 (Post-launch)
- [ ] Python pipeline as separate Cloud Run / Fly.io service
- [ ] Real-time Supabase subscriptions for live updates
- [ ] Export hypnogram as PNG/PDF
- [ ] Sleep staging comparison (week over week)

### Phase 6.2
- [ ] Integration with Google Fit / Apple HealthKit
- [ ] ML-based sleep quality predictions
- [ ] Personalized bedtime recommendations
- [ ] Nap detection and scoring

---

## 10. Rollback Plan

If deployment issues occur:
1. **Edge Functions**: `supabase functions delete sleep-webhook --project-ref <ref>`
2. **Frontend**: Revert `index.html` and `argon-sleep.js` to previous commit
3. **Database**: Schema is backward compatible (IF NOT EXISTS)
4. **CI/CD**: Disable workflow in GitHub Actions UI

---

## Appendix: File Structure

```
biohackargon-main/
├── index.html                 # Main frontend (updated with sleep containers)
├── argon-sleep.js             # NEW: Sleep staging dashboard module
├── argon-mbe.js               # Existing MBE+ module
├── argon-patch.js             # Existing patch module
├── simulate-recovery.js       # Existing simulation
├── config.js                  # User config (gitignored)
├── config.template.js         # Config template
├── supabase/
│   ├── config.toml            # NEW: Supabase config
│   └── functions/
│       ├── sleep-webhook/
│       │   ├── index.ts       # NEW: Sleep webhook Edge Function
│       │   └── import_map.json
│       └── strain-webhook/
│           ├── index.ts       # NEW: Strain webhook Edge Function
│           └── import_map.json
├── python/
│   ├── argon_algorithms/      # Core algorithms
│   ├── tests/                 # Unit tests
│   ├── validation/            # REA validation harness
│   └── pyproject.toml
├── sql/
│   ├── sleep_staging_schema.sql
│   └── expand_computed_daily_scores.sql
├── .github/workflows/
│   ├── ci.yml                 # NEW: CI/CD pipeline
│   └── pages.yml              # Existing Pages deploy
└── docs/
    └── PHASE6_DEPLOYMENT.md   # This file
```