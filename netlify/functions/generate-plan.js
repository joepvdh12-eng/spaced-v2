// SPACED v2 — AI Plan Generator
// Netlify Function: /.netlify/functions/generate-plan

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  // Auth check
  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const {
    sport = 'hyrox', goal = 'race', level = 'intermediate', weekly_days = 4, race_date,
    equipment = 'full_gym', injuries = [], preferred_days = [], week_start_date,
  } = body;

  // Prefer the athlete's own local calendar date for "this week" over the server's UTC
  // clock — the server can otherwise land on the wrong ISO week for anyone testing close
  // to midnight in a timezone ahead of UTC, generating a week that doesn't match what the
  // dashboard (using the browser's local time) is looking for.
  // All arithmetic below uses the UTC getters/setters explicitly so the result never
  // depends on whatever timezone the Netlify function happens to be running in.
  function mondayOf(dateStr) {
    const d = dateStr ? new Date(dateStr + 'T00:00:00Z') : new Date();
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day + (day === 0 ? -6 : 1));
    return d;
  }
  const weekStartDate = mondayOf(week_start_date);

  const weeksOut = race_date ? Math.ceil((new Date(race_date) - new Date()) / (7 * 86400000)) : 12;
  const phase = weeksOut > 8 ? 'Base' : weeksOut > 4 ? 'Build' : weeksOut > 2 ? 'Peak' : 'Taper';

  const DAY_TO_OFFSET = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  const dayOffsets = preferred_days.length
    ? preferred_days.map(d => DAY_TO_OFFSET[d]).filter(n => n !== undefined)
    : null;

  const equipmentNotes = {
    full_gym: 'Full gym access — barbells, racks, machines, cardio equipment all available.',
    home_basic: 'Home training only — dumbbells, kettlebells, resistance bands, pull-up bar. No barbells or machines.',
    bodyweight: 'Bodyweight only — no equipment at all. Every exercise must be doable with just body weight.',
    outdoor: 'Outdoor/track training — running and cycling focus, minimal to no gym equipment.',
  };

  const prompt = `You are an expert endurance and strength coach. Create a detailed 1-week training plan.

Athlete profile:
- Sport: ${sport.replace('_', ' ')}
- Goal: ${goal.replace('_', ' ')}
- Level: ${level}
- Available days/week: ${weekly_days}
- Equipment: ${equipmentNotes[equipment] || equipmentNotes.full_gym}
- Injuries/limitations: ${injuries.length ? injuries.join(', ') + ' — avoid or modify exercises that would aggravate these' : 'None reported'}
- Training phase: ${phase}${race_date ? `\n- Race date: ${race_date} (${weeksOut} weeks out)` : ''}

Generate exactly ${weekly_days} workout sessions for this week. Return ONLY valid JSON in this exact format:

{
  "phase": "${phase}",
  "week_notes": "brief note about this week's focus",
  "workouts": [
    {
      "day_offset": 0,
      "type": "strength|cardio|intervals|race_sim|recovery|technique",
      "title": "Workout name (max 40 chars)",
      "duration_minutes": 45,
      "description": "One sentence describing the session focus",
      "exercises": [
        {
          "name": "Exercise name",
          "sets": "3×8 or 20 min or 5km",
          "detail": "Rest/pace/intensity note"
        }
      ]
    }
  ]
}

Day offsets: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday.
${dayOffsets ? `The athlete can ONLY train on these day offsets: ${dayOffsets.join(', ')}. Use exactly these ${dayOffsets.length} day offsets, one workout per day, no others.` : `For ${weekly_days} days, spread them appropriately with rest days between hard sessions.`}
Only use exercises that fit the equipment available. Make workouts specific, progressive, and sport-appropriate. Include 4–6 exercises per workout.

Running-specific rule (applies to every running/jog/run exercise, in any sport — Hyrox running segments included, not just the "running" sport): NEVER prescribe running by time/duration alone. Always prescribe it by distance in km (or meters for short reps), and always give both a target pace per km (e.g. "5:30/km") and a target heart rate zone or bpm range (e.g. "Zone 2, 140–150bpm") in the "detail" field. Example: name "Easy run", sets "8km", detail "Zone 2, 145–155bpm, ~5:45/km". The top-level "duration_minutes" field may still estimate session length for scheduling, but every running exercise's own "sets" and "detail" must be distance + pace + heart rate, never just minutes.`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = msg.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const plan = JSON.parse(jsonMatch[0]);

    // Calculate actual dates and save to DB
    const savedWorkouts = [];
    for (const w of plan.workouts) {
      const d = new Date(weekStartDate);
      d.setUTCDate(d.getUTCDate() + (w.day_offset || 0));
      const { data: saved } = await sb.from('workouts').insert({
        user_id: user.id,
        scheduled_date: d.toISOString().split('T')[0],
        type: w.type,
        title: w.title,
        description: w.description,
        duration_minutes: w.duration_minutes,
        exercises_json: w.exercises,
        completed: false,
      }).select().single();
      if (saved) savedWorkouts.push(saved);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ phase: plan.phase, week_notes: plan.week_notes, workouts: savedWorkouts }),
    };

  } catch (err) {
    console.error('AI plan generation failed:', err);
    // Return fallback plan
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        phase, week_notes: 'Fallback plan — connect ANTHROPIC_API_KEY for AI-generated plans',
        workouts: getFallbackPlan(sport, level, weekly_days, dayOffsets, weekStartDate),
      }),
    };
  }
};

function getFallbackPlan(sport, level, days, dayOffsets, weekStart) {
  weekStart = weekStart || (() => {
    const d = new Date();
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day + (day === 0 ? -6 : 1));
    return d;
  })();

  const templates = [
    { offset: 0, type: 'strength', title: 'Upper Body + Core', duration: 55, exercises: [
      { name: 'Pull-ups', sets: '4×8', detail: '90s rest' },
      { name: 'Dumbbell Row', sets: '3×12 each', detail: '60s rest' },
      { name: 'Push-up Variants', sets: '4×15', detail: '60s rest' },
      { name: 'Plank Hold', sets: '3×45s', detail: '45s rest' },
      { name: 'Farmers Carry', sets: '4×30m', detail: 'Heavy' },
    ]},
    { offset: 2, type: 'intervals', title: '10×400m Speed Intervals', duration: 45, exercises: [
      { name: 'Warm-up jog', sets: '10 min', detail: 'Easy pace + drills' },
      { name: '400m repeats', sets: '10×400m', detail: '90s rest, target pace' },
      { name: 'Cool-down', sets: '5 min', detail: 'Walk/easy jog' },
    ]},
    { offset: 4, type: 'strength', title: 'Lower Body Power', duration: 60, exercises: [
      { name: 'Back Squat', sets: '4×6', detail: '85% 1RM, 2 min rest' },
      { name: 'Romanian Deadlift', sets: '3×10', detail: 'Controlled eccentric' },
      { name: 'Sled Push', sets: '6×20m', detail: '120kg, 2 min rest' },
      { name: 'Wall Ball', sets: '4×20', detail: '9/6kg' },
    ]},
    { offset: 5, type: 'race_sim', title: 'Mini Hyrox Simulation', duration: 75, exercises: [
      { name: 'Ski Erg', sets: '1000m', detail: 'Target < 4:30' },
      { name: '1km Run', sets: '1 round', detail: 'Zone 2 pace' },
      { name: 'Sled Push', sets: '50m', detail: '102/152kg' },
      { name: '1km Run + Wall Balls', sets: '20 reps', detail: '9/6kg' },
    ]},
  ];

  return templates.slice(0, days).map((t, i) => {
    const offset = (dayOffsets && dayOffsets[i] !== undefined) ? dayOffsets[i] : t.offset;
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + offset);
    return {
      scheduled_date: d.toISOString().split('T')[0],
      type: t.type, title: t.title, duration_minutes: t.duration,
      exercises_json: t.exercises, completed: false,
    };
  });
}
