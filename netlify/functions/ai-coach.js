// SPACED v2 — AI Coach Chat
// Netlify Function: /.netlify/functions/ai-coach

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const WORKOUT_TOOL = {
  name: 'set_workout',
  description: "Create or replace the athlete's scheduled workout for one specific date, so it shows up as a real, clickable session on their SPACED dashboard and is included in their PDF export. Call this every time you tell the athlete what to actually do for a session — adjusting today's workout because they're tired, swapping a day to a rest day, adding an extra session, changing exercises or intensity, etc. Never just describe a schedule change in the chat text alone — always call this tool so the dashboard actually reflects it.",
  input_schema: {
    type: 'object',
    properties: {
      scheduled_date: { type: 'string', description: 'Date the workout is for, as YYYY-MM-DD. Resolve relative terms like "today" or "Wednesday" using the current date given in the system prompt.' },
      type: { type: 'string', enum: ['strength', 'cardio', 'intervals', 'race_sim', 'recovery', 'technique'] },
      title: { type: 'string', description: 'Short workout name, max 40 characters' },
      duration_minutes: { type: 'number', description: 'Estimated session length in minutes, for scheduling purposes only' },
      description: { type: 'string', description: 'One sentence describing the session focus' },
      exercises: {
        type: 'array',
        description: 'Every running-related entry must give distance (km/m) plus a target pace per km and heart rate in "detail" — never just duration.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            sets: { type: 'string', description: 'e.g. "3×8", "8km", "10×400m"' },
            detail: { type: 'string', description: 'rest/pace/intensity/heart-rate note' },
          },
          required: ['name', 'sets'],
        },
      },
    },
    required: ['scheduled_date', 'type', 'title', 'duration_minutes', 'exercises'],
  },
};

async function upsertWorkout(sb, userId, w) {
  const { data: existing } = await sb.from('workouts').select('id')
    .eq('user_id', userId).eq('scheduled_date', w.scheduled_date).maybeSingle();

  const payload = {
    user_id: userId,
    scheduled_date: w.scheduled_date,
    type: w.type,
    title: w.title,
    description: w.description || null,
    duration_minutes: w.duration_minutes,
    exercises_json: w.exercises || [],
    completed: false,
  };

  if (existing) {
    const { data } = await sb.from('workouts').update(payload).eq('id', existing.id).select().single();
    return data;
  }
  const { data } = await sb.from('workouts').insert(payload).select().single();
  return data;
}

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
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { message, history = [], profile = '', schedule = '', attachment = null, today, recentLogs = [], postWorkout = null, language = 'en' } = body;
  const todayStr = today || new Date().toISOString().split('T')[0];

  const LANGUAGE_NAMES = { en: 'English', nl: 'Dutch', de: 'German', fr: 'French', es: 'Spanish' };
  const languageName = LANGUAGE_NAMES[language] || 'English';

  // Build recent training log context from workout_logs
  const logsContext = recentLogs.length > 0
    ? '\n\nRecent training log (most recent first):\n' + recentLogs.map(l =>
        `- ${l.date}: ${l.title} (${l.type}) — RPE ${l.perceived_effort}/10${l.notes ? ` — Notes: "${l.notes}"` : ''}`
      ).join('\n')
    : '';

  // If this is a post-workout message, prepend context
  const postWorkoutContext = postWorkout
    ? `\n\nPOST-WORKOUT CONTEXT: The athlete just completed "${postWorkout.title}" (${postWorkout.type}, ${postWorkout.duration_minutes} min) and rated the effort ${postWorkout.rpe}/10. They are now chatting with you directly after the session. Be encouraging, specific to their RPE, and ask a relevant follow-up question about their session.`
    : '';

  const systemPrompt = `You are an expert AI training coach for athletes. You are knowledgeable, direct, and practical. You give specific, actionable advice based on the athlete's profile and training context.

The athlete's app is set to ${languageName}. Always reply in ${languageName}, regardless of what language this system prompt or the schedule data below is written in — never answer in English unless ${languageName} IS English.

Today's date: ${todayStr}
Athlete profile: ${profile}
This week's actual scheduled workouts (ground truth — this is exactly what's in their dashboard right now): ${schedule}${logsContext}${postWorkoutContext}

Your coaching style:
- Lead with the direct answer in the first sentence — no warm-up, no throat-clearing.
- Keep it short: 2–4 sentences per point. If you're covering more than one point, put each on its own line (blank line between) rather than one dense paragraph.
- Plain text only — never use markdown (no **bold**, no #headers, no asterisks). The chat UI does not render it, so it would show up as literal asterisks. For a list, just start each line with "- ".
- Be specific and science-backed, never generic filler.
- Acknowledge fatigue and recovery as important as training.
- For Hyrox: emphasize pacing, station-specific prep, running economy.
- Use the athlete's sport context when answering.
- If you don't know something specific about their current plan, say so and give general guidance.
- The athlete can send photos (injuries, form checks, meals, existing schemes) or PDFs (bloodwork, prior programs). Look at them carefully and reference specific details you see before giving advice.
- Running rule: never think or advise in time/duration for running — always think in distance (km) with a target pace per km and a target heart rate (zone or bpm range). E.g. say "run 8km at 5:30/km, 140–150bpm" rather than "run for 45 minutes".
- Schedule changes: whenever you decide or tell the athlete what a session should actually be — adjusting a session, adding one, swapping a day to rest, resolving a day mix-up — call the set_workout tool to actually save it, for the exact date(s) involved, using the schedule above to know what's currently there. Then confirm in one short line, e.g. "Done — swapped Wednesday to a recovery day, check your dashboard."
- DAY SWAP: when the athlete asks to swap two days (e.g. "swap Tuesday and Thursday"), call set_workout TWICE in the SAME turn: first write Day A's original workout to Day B's date, then write Day B's original workout to Day A's date. Use the full exercise list from the schedule above for each. Do not describe the swap — just call the tool twice and confirm with one short line.
- FULL WEEK / MULTIPLE DAYS: when the athlete asks you to build, create, plan, or update their training week (or any request covering more than one day), call set_workout ONCE PER DAY, for every day involved, ALL IN THIS SAME TURN — before writing any reply text. Never say "I'll build your week" / "here's what I'm setting up" / "I'll load these into your dashboard now" as a stand-in for actually doing it — that leaves the dashboard empty and the athlete has to notice and call you out on it. Decide the full week first, then call set_workout for every one of those days in this turn, and only then write your short confirmation summarizing what you just saved.
- NEVER claim you've made, already made, or "already built" a schedule change — for one day or the whole week — unless you actually called set_workout in this same turn and it succeeded. If the athlete points out something is wrong or missing from their schedule, look at the actual schedule above, and if it really doesn't match what they want, fix it immediately by calling the tool — don't just reassure them it's already correct or promise to do it next.
- If a request is ambiguous (e.g. you can't tell which exact date they mean), ask one short clarifying question instead of guessing.

You have full knowledge of: periodization, strength training, endurance physiology, race strategy, nutrition for performance, recovery protocols, injury prevention, and sport-specific technique.`;

  let lastUserContent = message || 'Take a look at this attachment.';
  if (attachment?.base64 && attachment?.mediaType) {
    const attachmentBlock = attachment.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data: attachment.base64 } };
    lastUserContent = [attachmentBlock, { type: 'text', text: message || 'Take a look at this attachment.' }];
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const messages = [
      ...history.slice(-6).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: lastUserContent },
    ];

    let resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system: systemPrompt,
      messages,
      tools: [WORKOUT_TOOL],
    });

    const scheduleUpdates = []; // collect ALL set_workout results (e.g. both days in a swap)
    let safety = 0;

    // Tool-use loop: execute any set_workout calls against the DB, feed the result back,
    // and let the model produce its final natural-language reply.
    while (resp.stop_reason === 'tool_use' && safety < 5) {
      safety++;
      const toolUses = resp.content.filter(b => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: resp.content });

      const toolResults = [];
      for (const toolUse of toolUses) {
        let resultPayload;
        try {
          const saved = await upsertWorkout(sb, user.id, toolUse.input);
          scheduleUpdates.push({ date: toolUse.input.scheduled_date, title: toolUse.input.title, workout: saved });
          resultPayload = { success: true, workout: saved };
        } catch (err) {
          console.error('set_workout failed:', err);
          resultPayload = { success: false, error: err.message };
        }
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(resultPayload) });
      }
      messages.push({ role: 'user', content: toolResults });

      resp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: systemPrompt,
        messages,
        tools: [WORKOUT_TOOL],
      });
    }

    // The model can end a turn with only tool_use blocks and no closing text (especially
    // after several tool calls in a row, or when the safety cap cuts the loop short). The
    // fallback text must never claim success unless a schedule change actually saved —
    // saying "Done" when nothing was written is worse than saying nothing useful at all.
    const rawReplyText = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const DONE_FALLBACK = { en: 'Done — check your dashboard for the update.', nl: 'Gedaan — check je dashboard voor de update.', de: 'Erledigt — schau in dein Dashboard für das Update.', fr: 'C\'est fait — vérifie ton tableau de bord pour la mise à jour.', es: 'Hecho — revisa tu panel para ver la actualización.' };
    const ERROR_FALLBACK = { en: 'Sorry, something went wrong on my end and I couldn\'t complete that — please try again.', nl: 'Sorry, er ging iets mis aan mijn kant en ik heb dit niet kunnen afronden — probeer het opnieuw.', de: 'Entschuldigung, bei mir ist etwas schiefgelaufen und ich konnte das nicht abschließen — bitte versuch es erneut.', fr: 'Désolé, quelque chose s\'est mal passé de mon côté et je n\'ai pas pu terminer ça — réessaie s\'il te plaît.', es: 'Lo siento, algo salió mal de mi lado y no pude completar eso — por favor, inténtalo de nuevo.' };
    const replyText = rawReplyText
      || (scheduleUpdates.length > 0 ? DONE_FALLBACK[language] || DONE_FALLBACK.en : ERROR_FALLBACK[language] || ERROR_FALLBACK.en);

    // Return scheduleUpdates array; keep scheduleUpdate (last item) for backward compat
    const scheduleUpdate = scheduleUpdates.length > 0 ? scheduleUpdates[scheduleUpdates.length - 1] : null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: replyText, scheduleUpdate, scheduleUpdates }),
    };
  } catch (err) {
    console.error('AI coach error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI unavailable' }) };
  }
};
