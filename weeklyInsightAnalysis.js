/**
 * Heuristics for weekly screen-time insights (keep in sync with lib/utils/insight_analysis.dart).
 */

function lower(s) {
  return String(s || "").toLowerCase();
}

const GAMING = [
  "game", "play", "roblox", "minecraft", "fortnite", "pubg", "garena", "candy", "clash", "coc",
  "pokemon", "fifa", "nintendo", "steam", "epic", "valorant", "league of", "racing", "subway", "ludo",
  "among us", "call of duty", "codm", "free fire", "asphalt", "genshin", "mobile legends", "mlbb",
  "squad", "war frame", "xbox", "stadia", "ea sports", "zynga", "miniclip", "hungry", "dice",
  "battles", "rpg", "mmorpg", "mmo",
];

const SOCIAL = [
  "facebook", "instagram", "snapchat", "tiktok", "twitter", "whatsapp", "telegram", "reddit",
  "threads", "messenger", "wechat", "line", "signal", "discord", "linkedin", "pinterest",
  "tumblr", "bereal", "mastodon",
];

const VIDEO_SHORT = [
  "youtube", "tiktok", "shorts", "reels", "triller", "twitch", "netflix", "hulu", "disney+",
  "prime video", "hbo", "crunchyroll", "dailymotion", "vimeo", "bilibili",
];

const EDUCATION = [
  "duolingo", "khan", "coursera", "udemy", "wikipedia", "classroom", "google class", "byju", "unacademy",
  "brilliant", "photomath", "quizlet", "edpuzzle", "ixl", "lexia", "scholastic", "scratch", "mimo", "memrise",
  "elevate", "babbel", "cambly", "moodle", "blackboard", "schoo", "math", "science", "physics", "periodic",
  "dictionary", "ebook", "epub", "kindle", "audible", "socratic", "brainly", "ck-12", "luminar",
  "toca boca", "code.org", "lightbot", "sololearn", "academy",
];

function matchesAny(hay, needles) {
  for (const n of needles) {
    if (hay.includes(n)) return true;
  }
  return false;
}

function classifyApp(displayName, packageName) {
  const a = lower(displayName) + " " + lower(packageName);
  if (matchesAny(a, EDUCATION)) return "education";
  if (matchesAny(a, GAMING)) return "gaming";
  if (matchesAny(a, SOCIAL)) return "social";
  if (matchesAny(a, VIDEO_SHORT)) return "video";
  return "other";
}

const MEASURES = {
  gaming: [
    "Set or tighten daily play limits in Kidora and agree on a weekly cap together.",
    "Keep gaming off devices after a set evening time; charge devices outside the child’s room.",
    "Balance screen play with 20–30 minutes of physical activity or a family activity most days.",
  ],
  social: [
    "Use app time limits and scheduled downtime in Kidora for social apps.",
    "Try phone-free meals and a short daily window for checking messages together.",
    "Encourage in-person time with friends or hobbies that don’t require a screen.",
  ],
  video: [
    "Set a wind-down time with no short-form video for 60–90 minutes before bed.",
    "Turn on app reminders to take breaks every 20–30 minutes during long sessions.",
    "Replace one long viewing block per week with reading, art, or outdoor time.",
  ],
  overall: [
    "Review the daily limit in the app and adjust it with your child’s input.",
    "Use a predictable routine: homework, play, then screen time, then wind-down.",
    "Praise small wins (e.g. less time on the highest app vs last week) to build trust.",
  ],
};

/**
 * @param {Array<{app_name: string, package_name?: string, duration: number}>} apps
 * @param {number} totalSeconds
 */
function buildWeeklyInsights(apps, totalSeconds) {
  const total = Math.max(0, totalSeconds || 0);
  const concerns = [];
  const positives = [];

  let gameSec = 0;
  let socialSec = 0;
  let videoSec = 0;
  let eduSec = 0;

  for (const row of apps) {
    const d = parseInt(row.duration, 10) || 0;
    const c = classifyApp(row.app_name, row.package_name || row.app_name);
    if (c === "gaming") gameSec += d;
    if (c === "social") socialSec += d;
    if (c === "video") videoSec += d;
    if (c === "education") eduSec += d;
  }

  const pct = (sec) => (total > 0 ? (sec / total) * 100 : 0);
  const gamePct = pct(gameSec);
  const eduPct = pct(eduSec);
  const shortFormShare = pct(socialSec) + pct(videoSec);

  if (total > 0) {
    const hGame = gameSec / 3600;
    if (gamePct > 30 || hGame > 2) {
      concerns.push({
        key: "gaming",
        title: "High gaming time this week",
        body:
          gamePct > 30
            ? `About ${gamePct.toFixed(0)}% of this week’s screen time is in games.`
            : `Gaming time is around ${hGame.toFixed(1)} hours in total this week.`,
        measures: MEASURES.gaming,
      });
    }

    if (shortFormShare > 35 || (socialSec + videoSec) / 3600 > 3) {
      concerns.push({
        key: "socialvideo",
        title: "Heavy social and video use",
        body: `About ${shortFormShare.toFixed(0)}% of the week is social or video apps — easy to overdo without noticing.`,
        measures: MEASURES.social.concat(MEASURES.video).slice(0, 4),
      });
    }

    if (total / 3600 / 7 > 4) {
      concerns.push({
        key: "overall",
        title: "Overall screen time is high this week",
        body: `Roughly ${(total / 3600).toFixed(1)} hours total over 7 days — consider whether it matches your family’s goals.`,
        measures: MEASURES.overall,
      });
    }
  }

  if (eduSec > 0 && (eduPct > 5 || eduSec > 15 * 60)) {
    positives.push({
      title: "Learning time on device",
      body: `About ${eduPct.toFixed(0)}% of the week is in learning-style apps (~${(eduSec / 60).toFixed(0)} min). Keep encouraging curiosity.`,
    });
  }

  if (positives.length === 0 && total > 0) {
    const anyEdu = apps.some(
      (r) => classifyApp(r.app_name, r.package_name || r.app_name) === "education"
    );
    if (anyEdu) {
      positives.push({
        title: "Some learning time",
        body: "There was at least a bit of time in learning-related apps. Small consistent habits add up — worth a positive mention.",
      });
    }
  }

  if (total === 0) {
    positives.push({
      title: "No data this week",
      body: "We didn’t get enough per-app data for a full readout. Check that the child app can sync screen time to Kidora.",
    });
  } else if (concerns.length === 0 && positives.length === 0) {
    positives.push({
      title: "No strong risk flags",
      body: "Patterns look steady for this week. Keep light, open conversations about how they use their device.",
    });
  }

  return { concerns, positives, totalSeconds: total, stats: { gameSec, socialSec, videoSec, eduSec } };
}

module.exports = {
  classifyApp,
  buildWeeklyInsights,
};
