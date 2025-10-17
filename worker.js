addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

const badgeAssets = {
  "pull-shark":
    "https://github.githubassets.com/assets/pull-shark-default-498c279a747d.png",
  starstruck:
    "https://github.githubassets.com/assets/starstruck-default--light-medium-65b31ef2251e.png",
  "pair-extraordinaire":
    "https://github.githubassets.com/assets/pair-extraordinaire-default-579438a20e01.png",
  "galaxy-brain":
    "https://github.githubassets.com/assets/galaxy-brain-default-847262c21056.png",
  yolo: "https://github.githubassets.com/assets/yolo-default-be0bbff04951.png",
  quickdraw:
    "https://github.githubassets.com/assets/quickdraw-default--light-medium-5450fadcbe37.png",
  highlight:
    "https://github.githubassets.com/assets/highlight-default--light-medium-30e41ef7e6e7.png",
  community:
    "https://github.githubassets.com/assets/community-default-4c5bc57b9b55.png",
  "deep-diver":
    "https://github.githubassets.com/assets/deep-diver-default--light-medium-a7be3c095c3d.png",
  "arctic-code-vault-contributor":
    "https://github.githubassets.com/assets/arctic-code-vault-contributor-default-f5b6474c6028.png",
  "public-sponsor":
    "https://github.githubassets.com/assets/public-sponsor-default-4e30fe60271d.png",
  "heart-on-your-sleeve":
    "https://github.githubassets.com/assets/heart-on-your-sleeve-default-28aa2b2f7ffb.png",
  "open-sourcerer":
    "https://github.githubassets.com/assets/open-sourcerer-default-64b1f529dcdb.png",
};

const githubTokens = [];
const cerebrasKeys = [];

const FRONTEND_ORIGIN = "";

async function checkAchievementStatus(username, slug) {
  const url = `https://github.com/${encodeURIComponent(
    username
  )}?tab=achievements&achievement=${slug}`;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": "Cloudflare-Worker/1.0",
        Accept: "*/*",
      },
    });
    return res.status === 200 ? slug : null;
  } catch {
    return null;
  }
}

async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(getFrontendHTML(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.pathname === "/rate_limit") {
      let total = 0,
        used = 0,
        remaining = 0;
      const rateLimitUrl = "https://api.github.com/rate_limit";
      for (const token of githubTokens) {
        const headers = {
          Authorization: `token ${token}`,
          "User-Agent": "Cloudflare-Worker",
          Accept: "application/vnd.github.v3+json",
        };
        const resp = await fetch(rateLimitUrl, {
          headers,
          cf: { timeout: 60000 },
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        const r = data.rate;
        total += r.limit;
        used += r.used;
        remaining += r.remaining;
      }
      return new Response(
        JSON.stringify({
          rate: { limit: total, used: used, remaining: remaining },
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname === "/contributions") {
      const origin =
        request.headers.get("Origin") || request.headers.get("Referer") || "";
      if (!origin.startsWith(FRONTEND_ORIGIN)) {
        return new Response(
          JSON.stringify({ error: "Cross-origin requests are not allowed" }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const username = url.searchParams.get("username");
      if (!username) {
        return new Response(
          JSON.stringify({ error: "Username parameter is required" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const cacheKey = new Request(request.url, request);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const idx = Math.floor(Math.random() * githubTokens.length);
      const token = githubTokens[idx];
      const query = `
        {
          user(login: "${username}") {
            contributionsCollection {
              contributionCalendar {
                weeks {
                  contributionDays {
                    date
                    contributionCount
                  }
                }
              }
            }
          }
        }
      `;
      const graphResp = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "Cloudflare-Worker",
        },
        body: JSON.stringify({ query }),
      });
      if (!graphResp.ok) {
        const errorText = await graphResp.text();
        return new Response(
          JSON.stringify({
            error: `GitHub API error: ${graphResp.status} - ${errorText}`,
          }),
          {
            status: graphResp.status,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const result = await graphResp.json();
      const weeks =
        result.data.user.contributionsCollection.contributionCalendar.weeks ||
        [];
      const cellSize = 10,
        cellMargin = 2,
        daysCount = 7;
      const width = weeks.length * (cellSize + cellMargin) + cellMargin;
      const height = daysCount * (cellSize + cellMargin) + cellMargin;
      let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
      svg += '<rect width="100%" height="100%" fill="#1a1a1a"/>';
      const maxContrib = Math.max(
        1,
        ...weeks.flatMap((w) =>
          w.contributionDays.map((d) => d.contributionCount)
        )
      );
      weeks.forEach((week, wi) => {
        week.contributionDays.forEach((day, di) => {
          const x = wi * (cellSize + cellMargin);
          const y = di * (cellSize + cellMargin);
          const intensity = Math.min(day.contributionCount / maxContrib, 1);
          const fill =
            day.contributionCount === 0
              ? "#2f3727"
              : `rgba(0,255,0,${0.2 + intensity * 0.8})`;
          svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${fill}"/>`;
        });
      });
      svg += "</svg>";
      const responseSvg = new Response(svg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=3600",
        },
      });
      await cache.put(cacheKey, responseSvg.clone());
      return responseSvg;
    }
    if (url.pathname !== "/api") {
      return new Response(JSON.stringify({ error: "Invalid path" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const origin =
      request.headers.get("Origin") || request.headers.get("Referer") || "";
    if (!origin.startsWith(FRONTEND_ORIGIN)) {
      return new Response(
        JSON.stringify({ error: "Cross-origin requests are not allowed" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const username = url.searchParams.get("username");
    if (!username) {
      return new Response(
        JSON.stringify({ error: "Username parameter is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const index = Math.floor(Math.random() * githubTokens.length);
    const token = githubTokens[index];
    const cerebrasIndex = Math.floor(Math.random() * cerebrasKeys.length);
    const cerebrasKey = cerebrasKeys[cerebrasIndex];

    const headers = {
      Authorization: `token ${token}`,
      "User-Agent": "Cloudflare-Worker",
      Accept: "application/vnd.github.v3+json",
    };

    const rateLimitUrl = "https://api.github.com/rate_limit";
    const rateLimitResp = await fetch(rateLimitUrl, {
      headers,
      cf: { timeout: 60000 },
    });
    if (!rateLimitResp.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to check rate limit" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    const rateLimitData = await rateLimitResp.json();
    if (rateLimitData.rate.remaining === 0) {
      return new Response(
        JSON.stringify({ error: "GitHub API rate limit exceeded" }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const starCheckQuery = `
      {
        user(login: "${username}") {
          repository(name: "github-profile-analyzer") {
            viewerHasStarred
          }
        }
      }
    `;

    const starCheckUrl = `https://api.github.com/repos/0xarchit/github-profile-analyzer/stargazers?per_page=100`;
    let hasStarred = false;

    for (let page = 1; page <= 5; page++) {
      const starredResp = await fetch(`${starCheckUrl}&page=${page}`, {
        headers,
        cf: { timeout: 30000 },
      });
      if (!starredResp.ok) break;

      const stargazers = await starredResp.json();
      if (stargazers.length === 0) break;

      hasStarred = stargazers.some((user) => user.login === username);
      if (hasStarred) break;
    }

    if (!hasStarred) {
      return new Response(
        JSON.stringify({
          error:
            "You have not starred the 0xarchit/github-profile-analyzer repository",
          showPopup: true,
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    async function userHasCommits(repoName) {
      const commitsUrl = `https://api.github.com/repos/${username}/${repoName}/commits?author=${username}&per_page=1`;
      const commitsResp = await fetch(commitsUrl, {
        headers,
        cf: { timeout: 15000 },
      });
      if (!commitsResp.ok) return false;
      const commitsData = await commitsResp.json();
      return commitsData.length > 0;
    }

    const [userResp, reposResp] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`, {
        headers,
        cf: { timeout: 30000 },
      }),
      fetch(
        `https://api.github.com/users/${username}/repos?per_page=100&page=1&sort=updated`,
        {
          headers,
          cf: { timeout: 30000 },
        }
      ),
    ]);

    if (!userResp.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch user data" }),
        {
          status: userResp.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!reposResp.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch repositories" }),
        {
          status: reposResp.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const userData = await userResp.json();
    const reposData = await reposResp.json();

    const originalRepos = {};
    const authoredForks = {};

    const forks = [];
    for (const repo of reposData) {
      const repoName = repo.name;
      const isFork = repo.fork || false;

      const repoFields = {
        description: repo.description || null,
        stars: repo.stargazers_count || 0,
        forks: repo.forks_count || 0,
        issues: repo.open_issues || 0,
        watchers: repo.watchers || 0,
        primary_lang: repo.language || null,
        has_issues: repo.has_issues || false,
        has_projects: repo.has_projects || false,
        has_wiki: repo.has_wiki || false,
        has_pages: repo.has_pages || false,
        has_downloads: repo.has_downloads || false,
        has_discussions: repo.has_discussions || false,
        license: repo.license || {},
        topics: repo.topics || [],
      };

      if (!isFork) {
        originalRepos[repoName] = repoFields;
      } else {
        forks.push({ name: repoName, fields: repoFields });
      }
    }

    const BATCH_SIZE = 15;
    const contributedForks = [];

    for (let i = 0; i < forks.length; i += BATCH_SIZE) {
      const batch = forks.slice(i, i + BATCH_SIZE);
      const batchChecks = batch.map(async (fork) => {
        const hasContributed = await userHasCommits(fork.name);
        return hasContributed ? { name: fork.name, fields: fork.fields } : null;
      });

      const batchResults = (await Promise.all(batchChecks)).filter(
        (f) => f !== null
      );
      contributedForks.push(...batchResults);
    }

    contributedForks.forEach((fork) => {
      authoredForks[fork.name] = fork.fields;
    });

    const profileSummary = {
      avatar: userData.avatar_url || null,
      username: userData.login || null,
      name: userData.name || null,
      company: userData.company || null,
      location: userData.location || null,
      blog: userData.blog || null,
      bio: userData.bio || null,
      email: userData.email || null,
      twitter: userData.twitter_username || null,
      followers: userData.followers || 0,
      following: userData.following || 0,
      public_repo_count: userData.public_repos || 0,
      original_repos: originalRepos,
      authored_forks: authoredForks,
    };

    const slugs = Object.keys(badgeAssets);
    const unlockedBadges = await Promise.all(
      slugs.map((slug) => checkAchievementStatus(username, slug))
    );
    const badges = {};
    unlockedBadges.filter(Boolean).forEach((slug) => {
      badges[slug] = badgeAssets[slug];
    });
    profileSummary.badges = badges;

    const cerebrasResponse = await fetch(
      "https://api.cerebras.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cerebrasKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-oss-120b",
          messages: [
            {
              role: "system",
              content: `You are a JSON generator that evaluates a user's public GitHub profile data with high consistency and logical precision. 
              Your evaluation must be based on 10 weighted parameters, each contributing up to 10 points (for a total score out of 100). 
              Always return your output strictly in the following JSON structure:
              
              {
                "score": <integer between 0 and 100 representing overall GitHub profile strength>,
                "detailed_analysis": "<an insightful summary based on key metrics such as user popularity, repository quality, biography clarity, profile backlinks, and presence of web pages>",
                "improvement_areas": [
                  "<brief, specific suggestions for improving weak areas such as adding repository descriptions, refining bio, increasing stars or followers, etc.>"
                ],
                "diagnostics": [
                  "<additional observations such as number of licensed repositories, archived projects, or usage of pinned repos that do not directly impact score but are useful for awareness>"
                ],
                "project_ideas": {
                  "project_idea_1": {
                    "title": "<a short title for the project idea>",
                    "description": "<a detailed description of the project idea>",
                    "tech stack": []
                  },
                  "project_idea_2": {
                    "title": "<a short title for the project idea>",
                    "description": "<a detailed description of the project idea>",
                    "tech stack": []
                  },
                  "project_idea_3": {
                    "title": "<a short title for the project idea>",
                    "description": "<a detailed description of the project idea>",
                    "tech stack": []
                  }
                },
                "tag": {
                  "tag_name": "<a sarcastic or funny tag based on the user profile>",
                  "description": "<a short line explaining why this tag was given>"
                },
                "developer_type": "<developer type inferred from tech stack, repositories, and activeness — e.g., tech explorer, frontend dev, backend dev, fullstack dev, etc.>"
              }
              
              Scoring Method (10 parameters × 10 points each):
              1. Repository Quality – based on code quality, stars, forks, and activity.
              2. Repository Diversity – variety in domains, languages, and frameworks used.
              3. Profile Completeness – presence of bio, avatar, and external links.
              4. Popularity – followers, stars, forks, and engagement.
              5. Contribution Activity – frequency and consistency of commits or pull requests.
              6. Documentation & Descriptions – presence and clarity of repo descriptions or READMEs.
              7. Project Impact – originality, public utility, or technical depth.
              8. Skill Representation – clarity and balance of tech stack across repositories.
              9. Professional Presence – presence of pinned repos, portfolio link, and profile readability.
              10. Community Involvement – collaborations, contributions to others’ projects, or open-source participation.
              
              Rules:
              - Each parameter is rated from 0 to 10, sum gives the final score out of 100.
              - Use fixed threshold-based evaluation for consistency. Do not vary scores randomly.
              - Apply a ±1 variation only when metrics are borderline (never exceed ±1 total variation).
              - If data for a parameter is missing, give 0–2 points and mention it in diagnostics.
              - Use a constructive, analytic tone; never generic or repetitive.
              - Never invent data — base insights strictly on provided GitHub data.
              - Always return valid, complete JSON — no text outside JSON.
              - Project ideas should be new non repeative to exsisting on profile.
              `,
            },
            {
              role: "user",
              content: JSON.stringify(profileSummary),
            },
          ],
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!cerebrasResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch AI analysis" }),
        {
          status: cerebrasResponse.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const cerebrasData = await cerebrasResponse.json();
    const aiAnalysis = JSON.parse(cerebrasData.choices[0].message.content);

    const responseData = Object.assign({}, profileSummary, aiAnalysis);
    return new Response(JSON.stringify(responseData), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Worker error: ${error.message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

function getFrontendHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="google-site-verification" content="dHMBieXdOHmVBKYMO3BKUtVtEarad3beBlC6Nd65BAo" />
  <link rel="icon" href="https://i.postimg.cc/cLSGtFfZ/Gemini-Generated-Image-kszdpvkszdpvkszd.png">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="title" content="GitHub Profile Analyzer Tool With AI">
  <meta name="description" content="This tool analyzes a GitHub user's public profile and generates a detailed strength score, insightful analysis, and improvement suggestions and display profile with several charts and graphs">
  <meta name="keywords" content="Github Profile Analyzer, Github Profile Analyser, Github, Profile analyser, 0xarchit">
  <meta property="og:url" content="https://git.0xcloud.workers.dev">
  <meta name="robots" content="index, follow">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="language" content="English">
  <meta name="revisit-after" content="7 days">
  <meta name="author" content="0xArchit">
  <title>GitHub Profile Analyzer</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    * {
      user-drag: none;
      -webkit-user-drag: none;
      user-select: none;
      -moz-user-select: none;
      -webkit-user-select: none;
      -ms-user-select: none;
    }
    
    :root {
      --progress-bar-width: 180px;
      --progress-bar-height: 180px;
      --font-size: 1.5rem;
      
      /* Light theme colors */
      --bg-primary: #f8fafc;
      --bg-secondary: #ffffff;
      --bg-tertiary: #f1f5f9;
      --text-primary: #0f172a;
      --text-secondary: #475569;
      --text-tertiary: #64748b;
      --border-color: #e2e8f0;
      --accent-primary: #3b82f6;
      --accent-secondary: #8b5cf6;
      --accent-hover: #2563eb;
      --glass-bg: rgba(255, 255, 255, 0.7);
      --glass-border: rgba(226, 232, 240, 0.8);
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
      --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.1);
      --gradient-start: #3b82f6;
      --gradient-end: #8b5cf6;
    }
    
    [data-theme="dark"] {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-tertiary: #334155;
      --text-primary: #f8fafc;
      --text-secondary: #cbd5e1;
      --text-tertiary: #94a3b8;
      --border-color: #334155;
      --accent-primary: #60a5fa;
      --accent-secondary: #a78bfa;
      --accent-hover: #3b82f6;
      --glass-bg: rgba(30, 41, 59, 0.7);
      --glass-border: rgba(51, 65, 85, 0.8);
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
      --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
      --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.5);
    }
    
    body {
      background: var(--bg-primary);
      color: var(--text-primary);
      transition: background 0.3s ease, color 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    }
    
    .glassmorphism {
      background: var(--glass-bg);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-radius: 16px;
      border: 1px solid var(--glass-border);
      box-shadow: var(--shadow-md);
      transition: all 0.3s ease;
    }
    
    .glassmorphism:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-2px);
    }
    
    .card {
      background: var(--bg-secondary);
      border-radius: 16px;
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-sm);
      transition: all 0.3s ease;
    }
    
    .card:hover {
      box-shadow: var(--shadow-md);
    }
    
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    @keyframes scaleIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    
    .animate-slideIn {
      animation: slideIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    
    .animate-fadeIn {
      animation: fadeIn 0.5s ease forwards;
    }
    
    .animate-scaleIn {
      animation: scaleIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    
    .popup {
      background: var(--glass-bg);
      backdrop-filter: blur(20px) saturate(180%);
      border-radius: 20px;
      border: 1px solid var(--glass-border);
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 1000;
      padding: 32px;
      max-width: 90%;
      width: 400px;
      text-align: center;
      box-shadow: var(--shadow-lg);
      animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    .popup-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      z-index: 999;
      animation: fadeIn 0.3s ease;
    }
    
    .loader {
      border: 4px solid var(--border-color);
      border-top: 4px solid var(--accent-primary);
      border-radius: 50%;
      width: 48px;
      height: 48px;
      animation: spin 0.8s linear infinite;
      margin: 0 auto;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .circular-progress {
      width: var(--progress-bar-width);
      height: var(--progress-bar-height);
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
    }
    
    .inner-circle {
      position: absolute;
      width: calc(var(--progress-bar-width) - 40px);
      height: calc(var(--progress-bar-height) - 40px);
      border-radius: 50%;
      background: var(--bg-secondary);
      box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.1);
    }
    
    .percentage {
      position: relative;
      font-size: var(--font-size);
      color: var(--text-primary);
      font-weight: 700;
      z-index: 1;
    }
    
    .btn-primary {
      background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
      color: white;
      font-weight: 600;
      padding: 14px 28px;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
      position: relative;
      overflow: hidden;
    }
    
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
    }
    
    .btn-primary:active {
      transform: translateY(0);
    }
    
    .btn-secondary {
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-weight: 600;
      padding: 10px 20px;
      border-radius: 10px;
      border: 1px solid var(--border-color);
      cursor: pointer;
      transition: all 0.3s ease;
    }
    
    .btn-secondary:hover {
      background: var(--bg-tertiary);
      border-color: var(--accent-primary);
    }
    
    .theme-toggle {
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      border: 1px solid var(--glass-border);
      border-radius: 50px;
      padding: 8px 16px;
      cursor: pointer;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: var(--shadow-md);
      transition: all 0.3s ease;
    }
    
    .theme-toggle:hover {
      box-shadow: var(--shadow-lg);
      transform: scale(1.05);
    }
    
    .theme-toggle i {
      font-size: 18px;
      color: var(--text-primary);
    }
    
    input[type="text"] {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border: 2px solid var(--border-color);
      border-radius: 12px;
      padding: 14px 20px;
      font-size: 16px;
      transition: all 0.3s ease;
    }
    
    input[type="text"]:focus {
      outline: none;
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    
    .badge-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    
    .badge-item {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 2px solid var(--border-color);
      transition: all 0.3s ease;
      cursor: pointer;
    }
    
    .badge-item:hover {
      transform: scale(1.2);
      border-color: var(--accent-primary);
    }
    
    .stat-card {
      text-align: center;
      padding: 16px;
    }
    
    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--accent-primary);
    }
    
    .stat-label {
      font-size: 12px;
      color: var(--text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }
    
    .section-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .section-title i {
      color: var(--accent-primary);
    }
    
    .tag-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
      color: white;
      padding: 12px 20px;
      border-radius: 50px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }
    
    .project-card {
      background: var(--bg-tertiary);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      border: 1px solid var(--border-color);
      transition: all 0.3s ease;
    }
    
    .project-card:hover {
      border-color: var(--accent-primary);
      box-shadow: var(--shadow-md);
    }
    
    .tech-stack {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    
    .tech-tag {
      background: var(--bg-secondary);
      color: var(--accent-primary);
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid var(--border-color);
    }
    
    .rate-limit-widget {
      position: fixed;
      top: 20px;
      left: 20px;
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      color: var(--text-primary);
      padding: 16px;
      border-radius: 12px;
      cursor: move;
      z-index: 100;
      font-size: 14px;
      border: 1px solid var(--glass-border);
      box-shadow: var(--shadow-md);
      user-select: none;
    }
    
    .rate-limit-widget strong {
      display: block;
      margin-bottom: 8px;
      color: var(--accent-primary);
    }
    
    @media screen and (max-width: 800px) {
      :root {
        --progress-bar-width: 150px;
        --progress-bar-height: 150px;
        --font-size: 1.3rem;
      }
      
      .theme-toggle {
        top: 10px;
        right: 10px;
        padding: 6px 12px;
      }
      
      .rate-limit-widget {
        font-size: 12px;
        padding: 12px;
      }
    }
    
    @media screen and (max-width: 500px) {
      :root {
        --progress-bar-width: 130px;
        --progress-bar-height: 130px;
        --font-size: 1.1rem;
      }
      
      .popup {
        width: 90%;
        padding: 24px;
      }
      
      .section-title {
        font-size: 18px;
      }
    }
    
    @media print {
      @page {
        margin: 0 !important;
      }
      body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
      }
      .rate-limit-widget,
      .theme-toggle,
      footer,
      #copy-url,
      #download-report,
      #username,
      #analyze,
      #loading,
      #username-box,
      h1,
      h4 {
        display: none !important;
      }
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .no-print {
        display: none !important;
      }
    }
    
    
    ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    
    ::-webkit-scrollbar-track {
      background: var(--bg-tertiary);
      border-radius: 10px;
    }
    
    ::-webkit-scrollbar-thumb {
      background: var(--accent-primary);
      border-radius: 10px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: var(--accent-hover);
    }
    
    
    .gradient-text {
      background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    
    @keyframes shimmer {
      0% {
        background-position: -1000px 0;
      }
      100% {
        background-position: 1000px 0;
      }
    }
    
    .shimmer {
      background: linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 50%, var(--bg-secondary) 100%);
      background-size: 1000px 100%;
      animation: shimmer 2s infinite;
    }

    
    .hidden { display: none !important; }
  </style>
</head>
<body class="min-h-screen flex flex-col items-center p-4 pb-20">
  
  <!-- Theme Toggle -->
  <div class="theme-toggle" id="theme-toggle">
    <i class="fas fa-sun" id="theme-icon"></i>
  </div>
  
  <!-- Rate Limit Widget -->
  <div class="rate-limit-widget" id="rate-limit-widget">
    <strong><i class="fas fa-chart-line"></i> API Rate Limit</strong>
    <div>Total: <span id="rl-total">--</span></div>
    <div>Used: <span id="rl-used">--</span></div>
    <div>Remaining: <span id="rl-remaining">--</span></div>
  </div>
  
  <div class="w-full max-w-7xl mt-8">
    <!-- Hero Section -->
    <div class="text-center mb-12 animate-slideIn">
      <h1 class="text-5xl font-bold mb-4 gradient-text">
        <i class="fab fa-github"></i> GitHub Profile Analyzer
      </h1>
      <p class="text-lg" style="color: var(--text-secondary);">
        Analyze your GitHub profile with AI-powered insights
      </p>
    </div>
    
    <h4 class="text-sm font-medium mb-8 text-center animate-slideIn" style="color: var(--text-tertiary); animation-delay: 0.1s;">
      Analysis based on your first 100 repos including original repos and contributed forks
    </h4>
    
    <!-- Search Box -->
    <div id="username-box" class="mb-8 glassmorphism p-6 max-w-2xl mx-auto animate-slideIn" style="animation-delay: 0.2s;">
      <div class="flex flex-col sm:flex-row gap-4">
        <input 
          id="username" 
          type="text" 
          placeholder="Enter GitHub username" 
          class="flex-1"
        >
        <button id="analyze" class="btn-primary whitespace-nowrap">
          <i class="fas fa-search"></i> Analyze Profile
        </button>
      </div>
    </div>
    
    <!-- Loading State -->
    <div id="loading" class="hidden glassmorphism p-8 mb-8 max-w-md mx-auto text-center">
      <div class="loader"></div>
      <p class="mt-4 font-semibold" style="color: var(--text-primary);" id="loading-status">Analyzing your profile...</p>
      <p class="text-sm mt-2" style="color: var(--text-tertiary);" id="loading-substatus">This may take a few moments</p>
      <div class="mt-4 w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700" style="background: var(--bg-tertiary);">
        <div id="loading-progress" class="h-2 rounded-full transition-all duration-500" style="width: 0%; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end));"></div>
      </div>
    </div>
    
    <!-- Results Section -->
    <div id="result" class="mt-8 hidden">
      
      <!-- Profile & Score Row -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        
        <!-- Profile Card -->
        <div id="profile-card" class="lg:col-span-2 card p-6 hidden animate-scaleIn" style="position: relative; overflow: hidden;">
          <!-- Contribution Background -->
          <div id="profile-contrib" style="position: absolute; top: 0; left: 0; width: 100%; height: 80px; background-size: cover; background-position: center; opacity: 0.3; border-radius: 16px 16px 0 0;"></div>
          
          <div class="relative z-10 flex flex-col sm:flex-row gap-6">
            <img id="profile-avatar" src="" alt="avatar" class="w-24 h-24 rounded-full border-4 shadow-lg" style="border-color: var(--accent-primary);" />
            
            <div class="flex-1">
              <div class="flex flex-wrap items-center gap-3 mb-2">
                <span class="text-2xl font-bold" id="profile-username"></span>
                <div id="profile-badges" class="badge-container"></div>
              </div>
              
              <div class="text-lg mb-2" style="color: var(--text-secondary);" id="profile-name"></div>
              <div class="text-sm mb-4" style="color: var(--text-tertiary);" id="profile-bio"></div>
              
              <div class="flex flex-wrap gap-4 text-sm" style="color: var(--text-tertiary);">
                <span id="profile-email"></span>
                <span id="profile-company"></span>
              </div>
              
              <!-- Stats Grid -->
              <div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-6">
                <div class="stat-card">
                  <div class="stat-value" id="profile-followers">0</div>
                  <div class="stat-label">Followers</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value" id="profile-following">0</div>
                  <div class="stat-label">Following</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value" id="profile-repos">0</div>
                  <div class="stat-label">Public Repos</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value" id="profile-original-repos">0</div>
                  <div class="stat-label">Original</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value" id="profile-authored-forks">0</div>
                  <div class="stat-label">Contributed</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Score Card -->
        <div id="score-wrapper" class="card p-6 flex flex-col justify-center items-center animate-scaleIn" style="animation-delay: 0.1s;">
          <div class="section-title mb-4">
            <i class="fas fa-trophy"></i>
            <span>Profile Score</span>
          </div>
          <div class="circular-progress" id="score-progress" data-inner-circle-color="rgba(0, 0, 0, 0.8)" data-percentage="0" data-progress-color="#3b82f6" data-bg-color="rgba(203, 213, 225, 0.3)">
            <div class="inner-circle"></div>
            <p class="percentage" id="score-text">0/100</p>
          </div>
        </div>
      </div>
      
      <!-- Action Buttons -->
      <div class="flex flex-wrap justify-end gap-3 mb-6">
        <button id="copy-url" class="hidden btn-secondary">
          <i class="fas fa-link"></i> Copy URL
        </button>
        <button id="download-report" class="hidden btn-secondary">
          <i class="fas fa-download"></i> Save Report
        </button>
      </div>
      
      <!-- Analysis Cards -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        
        <!-- Detailed Analysis -->
        <div class="card p-6 animate-fadeIn" style="animation-delay: 0.2s;">
          <div class="section-title">
            <i class="fas fa-brain"></i>
            <span>AI Analysis</span>
          </div>
          <p id="detailed-analysis" style="color: var(--text-secondary); line-height: 1.6;"></p>
        </div>
        
        <!-- Improvement Areas -->
        <div class="card p-6 animate-fadeIn" style="animation-delay: 0.3s;">
          <div class="section-title">
            <i class="fas fa-lightbulb"></i>
            <span>Improvement Areas</span>
          </div>
          <ul id="improvement-areas" class="list-disc list-inside space-y-2" style="color: var(--text-secondary);"></ul>
        </div>
      </div>
      
      <!-- Developer Type & Tag -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        
        <!-- Developer Type -->
        <div class="card p-6 animate-fadeIn" style="animation-delay: 0.4s;">
          <div class="section-title">
            <i class="fas fa-code"></i>
            <span>Developer Type</span>
          </div>
          <p id="developer-type" class="text-lg font-semibold" style="color: var(--accent-primary);"></p>
        </div>
        
        <!-- Tag -->
        <div class="card p-6 animate-fadeIn" style="animation-delay: 0.5s;">
          <div class="section-title">
            <i class="fas fa-tag"></i>
            <span>Profile Tag</span>
          </div>
          <div id="tag-section" style="display: none;"></div>
        </div>
      </div>
      
      <!-- Diagnostics -->
      <div class="card p-6 mb-6 animate-fadeIn" style="animation-delay: 0.6s;">
        <div class="section-title">
          <i class="fas fa-stethoscope"></i>
          <span>Diagnostics</span>
        </div>
        <ul id="diagnostics" class="list-disc list-inside space-y-2" style="color: var(--text-secondary);"></ul>
      </div>
      
      <!-- Project Ideas -->
      <div class="card p-6 mb-6 animate-fadeIn" style="animation-delay: 0.7s;">
        <div class="section-title">
          <i class="fas fa-rocket"></i>
          <span>Project Ideas</span>
        </div>
        <div id="project-ideas-list"></div>
      </div>
      
      <!-- Badges -->
      <div class="card p-6 mb-6 animate-fadeIn" style="animation-delay: 0.8s;">
        <div class="section-title">
          <i class="fas fa-medal"></i>
          <span>GitHub Achievements</span>
        </div>
        <div id="badges" class="flex flex-wrap gap-3"></div>
      </div>
      
      <!-- Stats & Graphs -->
      <div class="card p-6 mb-6 animate-fadeIn" style="animation-delay: 0.9s;">
        <div class="section-title">
          <i class="fas fa-chart-bar"></i>
          <span>Statistics & Graphs</span>
        </div>
        <div id="graphs" class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 hidden">
          <img id="stats-graph" class="w-full rounded-lg" alt="stats graph" />
          <img id="langs-graph" class="w-full rounded-lg" alt="languages graph" />
          <img id="streak-graph-daily" class="w-full rounded-lg" alt="daily streak graph" />
          <img id="streak-graph-weekly" class="w-full rounded-lg" alt="weekly streak graph" />
          <img id="trophy-graph" class="w-full rounded-lg md:col-span-2" alt="trophy graph" />
          <img id="activity-graph" class="w-full rounded-lg md:col-span-2" alt="activity graph" />
        </div>
      </div>
      
    </div>
  </div>
  
  <!-- Popup -->
  <div id="popup-overlay" class="popup-overlay hidden"></div>
  <div id="popup" class="popup hidden">
    <button id="popup-close" class="absolute top-4 right-4 text-2xl" style="color: var(--text-primary);">
      <i class="fas fa-times"></i>
    </button>
    <p id="popup-message" class="mb-6" style="color: var(--text-primary);"></p>
    <div id="popup-input-container" class="hidden mb-4">
      <input id="popup-input" type="text" readonly class="w-full mb-4" style="cursor: text;" />
    </div>
    <div id="popup-buttons" class="flex gap-3 justify-center">
      <a id="star-button" href="https://github.com/0xarchit/github-profile-analyzer" target="_blank" class="btn-primary hidden">
        <i class="fas fa-star"></i> Star Now
      </a>
      <button id="popup-copy-button" class="btn-primary hidden">
        <i class="fas fa-copy"></i> Copy
      </button>
      <button id="popup-cancel-button" class="btn-secondary hidden">
        <i class="fas fa-times"></i> Cancel
      </button>
    </div>
  </div>
  <script>
    
    function initTheme() {
      const savedTheme = localStorage.getItem('theme') || 'dark';
      document.documentElement.setAttribute('data-theme', savedTheme);
      updateThemeIcon(savedTheme);
    }
    
    function updateThemeIcon(theme) {
      const icon = document.getElementById('theme-icon');
      icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
    
    function toggleTheme() {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      updateThemeIcon(newTheme);
    }
    
    
    initTheme();
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    
    const elements = {
      username: document.getElementById('username'),
      result: document.getElementById('result'),
      graphs: document.getElementById('graphs'),
      scoreProgress: document.getElementById('score-progress'),
      scoreText: document.getElementById('score-text'),
      detailedAnalysis: document.getElementById('detailed-analysis'),
      improvementAreas: document.getElementById('improvement-areas'),
      diagnostics: document.getElementById('diagnostics'),
      projectIdeasList: document.getElementById('project-ideas-list'),
      developerType: document.getElementById('developer-type'),
      tagSection: document.getElementById('tag-section'),
      popup: document.getElementById('popup'),
      popupOverlay: document.getElementById('popup-overlay'),
      popupMessage: document.getElementById('popup-message'),
      starButton: document.getElementById('star-button'),
      statsGraph: document.getElementById('stats-graph'),
      langsGraph: document.getElementById('langs-graph'),
      streakGraphDaily: document.getElementById('streak-graph-daily'),
      streakGraphWeekly: document.getElementById('streak-graph-weekly'),
      trophyGraph: document.getElementById('trophy-graph'),
      activityGraph: document.getElementById('activity-graph'),
      analyze: document.getElementById('analyze'),
      popupClose: document.getElementById('popup-close'),
      loading: document.getElementById('loading'),
      loadingStatus: document.getElementById('loading-status'),
      loadingSubstatus: document.getElementById('loading-substatus'),
      loadingProgress: document.getElementById('loading-progress'),
      copyUrl: document.getElementById('copy-url'),
      downloadReport: document.getElementById('download-report'),
      profileCard: document.getElementById('profile-card'),
      profileContrib: document.getElementById('profile-contrib'),
      profileAvatar: document.getElementById('profile-avatar'),
      profileUsername: document.getElementById('profile-username'),
      profileName: document.getElementById('profile-name'),
      profileBio: document.getElementById('profile-bio'),
      profileEmail: document.getElementById('profile-email'),
      profileCompany: document.getElementById('profile-company'),
      profileFollowers: document.getElementById('profile-followers'),
      profileFollowing: document.getElementById('profile-following'),
      profileRepos: document.getElementById('profile-repos'),
      profileOriginalRepos: document.getElementById('profile-original-repos'),
      profileAuthoredForks: document.getElementById('profile-authored-forks'),
      profileBadges: document.getElementById('profile-badges'),
      badges: document.getElementById('badges'),
      popupInputContainer: document.getElementById('popup-input-container'),
      popupInput: document.getElementById('popup-input'),
      popupCopyButton: document.getElementById('popup-copy-button'),
      popupCancelButton: document.getElementById('popup-cancel-button')
    };
    
    
    function updateLoadingProgress(percent, status, substatus) {
      elements.loadingProgress.style.width = percent + '%';
      if (status) elements.loadingStatus.textContent = status;
      if (substatus) elements.loadingSubstatus.textContent = substatus;
    }

    elements.analyze.addEventListener('click', async function() {
      const username = elements.username.value.trim();
      if (!username) {
        showPopup('<i class="fas fa-exclamation-circle"></i> Please enter a GitHub username', false);
        return;
      }

      const cacheKey = 'analysis_' + username;
      elements.loading.classList.remove('hidden');
      elements.result.classList.add('hidden');
      updateLoadingProgress(10, 'Starting analysis...', 'Checking cache');
      
      try {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          let parsedData;
          try {
            parsedData = JSON.parse(cachedData);
          } catch (e) {
            console.error('Failed to parse cached data:', e);
            localStorage.removeItem(cacheKey);
          }
          if (parsedData && parsedData.data && parsedData.timestamp) {
            if (Date.now() - parsedData.timestamp < 3600000) {
              updateLoadingProgress(100, 'Loading cached results...', 'Done!');
              setTimeout(() => {
                elements.loading.classList.add('hidden');
                displayResult(parsedData.data, username);
                refreshRateLimit();
              }, 500);
              return;
            }
          }
        }
      } catch (e) {
        console.error('LocalStorage error:', e);
        updateLoadingProgress(0, 'Error', 'Cache error');
        elements.loading.classList.add('hidden');
        showPopup('<i class="fas fa-exclamation-triangle"></i> Error accessing local storage', false);
        return;
      }

      updateLoadingProgress(20, 'Fetching profile data...', 'Connecting to GitHub');
      
      try {
        const response = await fetch('/api?username=' + encodeURIComponent(username));
        updateLoadingProgress(40, 'Processing data...', 'Analyzing repositories');
        
        
        const progressInterval = setInterval(() => {
          const currentWidth = parseFloat(elements.loadingProgress.style.width) || 40;
          if (currentWidth < 80) {
            updateLoadingProgress(currentWidth + 5, null, null);
          }
        }, 800);
        
        const data = await response.json();
        clearInterval(progressInterval);
        
        updateLoadingProgress(90, 'Finalizing analysis...', 'Almost done!');
        
        setTimeout(() => {
          elements.loading.classList.add('hidden');
        }, 500);
        
        if (response.status !== 200) {
          showPopup('<i class="fas fa-exclamation-triangle"></i> ' + (data.error || 'An error occurred'), data.showPopup || false);
          return;
        }
        
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            data: data,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.error('Failed to save to localStorage:', e);
        }
        
        displayResult(data, username);
        refreshRateLimit();
      } catch (error) {
        elements.loading.classList.add('hidden');
        showPopup('<i class="fas fa-exclamation-triangle"></i> Error fetching analysis', false);
      }
    });
    
    
    elements.username.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        elements.analyze.click();
      }
    });

    function displayResult(data, username) {
      elements.result.classList.remove('hidden');
      elements.graphs.classList.remove('hidden');
      
      
      setTimeout(() => {
        elements.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      
      
      if (data && data.username) {
        elements.profileCard.style.display = '';
        elements.profileCard.classList.remove('hidden');
        elements.profileAvatar.src = data.avatar || data.avatar_url || '';
        elements.profileContrib.style.backgroundImage = "url('/contributions?username=" + username + "')";
        elements.profileUsername.textContent = data.username || '';
        elements.profileName.textContent = data.name || '';
        elements.profileBio.textContent = data.bio || 'No bio available';
        elements.profileEmail.innerHTML = data.email ? '<i class="fas fa-envelope"></i> ' + data.email : '';
        elements.profileCompany.innerHTML = data.company ? '<i class="fas fa-building"></i> ' + data.company : '';
        elements.profileFollowers.textContent = data.followers || '0';
        elements.profileFollowing.textContent = data.following || '0';
        elements.profileRepos.textContent = data.public_repo_count || '0';
        elements.profileOriginalRepos.textContent = data.original_repos ? Object.keys(data.original_repos).length : '0';
        elements.profileAuthoredForks.textContent = data.authored_forks ? Object.keys(data.authored_forks).length : '0';
        
        
        elements.profileBadges.innerHTML = '';
        const badgeKeys = Object.keys(data.badges || {}).slice(0, 6);
        badgeKeys.forEach(slug => {
          const img = document.createElement('img');
          img.src = data.badges[slug];
          img.alt = slug;
          img.className = 'badge-item';
          img.title = slug.replace(/-/g, ' ').toUpperCase();
          elements.profileBadges.appendChild(img);
        });
      } else {
        elements.profileCard.style.display = 'none';
      }
      
      
      const score = data.score || 0;
      animateScore(score);
      
      
      elements.detailedAnalysis.textContent = data.detailed_analysis || 'No analysis provided';
      
      
      elements.improvementAreas.innerHTML = '';
      (data.improvement_areas || []).forEach(function(item) {
        const li = document.createElement('li');
        li.innerHTML = '<i class="fas fa-arrow-right" style="color: var(--accent-primary); margin-right: 8px;"></i>' + item;
        elements.improvementAreas.appendChild(li);
      });
      
      
      elements.diagnostics.innerHTML = '';
      (data.diagnostics || []).forEach(function(item) {
        const li = document.createElement('li');
        li.innerHTML = '<i class="fas fa-check-circle" style="color: var(--accent-secondary); margin-right: 8px;"></i>' + item;
        elements.diagnostics.appendChild(li);
      });
      
      
      elements.developerType.innerHTML = '<i class="fas fa-laptop-code"></i> ' + (data.developer_type || 'Developer');
      
      
      if (data.tag) {
        let name = '', desc = '';
        if (data.tag.tag_name && data.tag.description) {
          name = data.tag.tag_name;
          desc = data.tag.description;
        } else {
          const keys = Object.keys(data.tag);
          if (keys.length) {
            name = keys[0];
            desc = data.tag[name] || '';
          }
        }
        elements.tagSection.innerHTML = '<div class="tag-badge"><i class="fas fa-award"></i><div><strong>' + name + '</strong><br><small>' + desc + '</small></div></div>';
        elements.tagSection.style.display = name ? '' : 'none';
      } else {
        elements.tagSection.style.display = 'none';
      }
      
      
      elements.projectIdeasList.innerHTML = '';
      (data.project_ideas ? Object.values(data.project_ideas) : []).forEach(idea => {
        const techs = idea.tech_stack || idea['tech stack'] || [];
        const div = document.createElement('div');
        div.className = 'project-card';
        div.innerHTML = '<h4 class="font-bold text-lg mb-2" style="color: var(--accent-primary);"><i class="fas fa-lightbulb"></i> ' + idea.title + '</h4><p style="color: var(--text-secondary); margin-bottom: 12px;">' + idea.description + '</p><div class="tech-stack">' + techs.map(t => '<span class="tech-tag">' + t + '</span>').join('') + '</div>';
        elements.projectIdeasList.appendChild(div);
      });
      
      
      elements.badges.innerHTML = '';
      const badges = data.badges || {};
      Object.keys(badges).forEach(function(slug) {
        const div = document.createElement('div');
        div.className = 'text-center';
        div.innerHTML = '<img src="' + badges[slug] + '" alt="' + slug + '" class="w-16 h-16 rounded-full border-2 hover:scale-110 transition-transform cursor-pointer" style="border-color: var(--border-color);" title="' + slug.replace(/-/g, ' ').toUpperCase() + '" /><p class="text-xs mt-1" style="color: var(--text-tertiary);">' + slug.replace(/-/g, ' ') + '</p>';
        elements.badges.appendChild(div);
      });
      
      
      const theme = document.documentElement.getAttribute('data-theme');
      const graphTheme = theme === 'dark' ? 'dark' : 'default';
      
      elements.statsGraph.src = 'https://github-readme-stats.vercel.app/api?username=' + encodeURIComponent(username) + '&hide_title=false&hide_rank=false&show_icons=true&include_all_commits=true&count_private=true&disable_animations=false&theme=' + graphTheme + '&locale=en&hide_border=false&order=1';
      elements.langsGraph.src = 'https://github-readme-stats.vercel.app/api/top-langs?username=' + encodeURIComponent(username) + '&locale=en&hide_title=false&layout=compact&card_width=320&langs_count=5&theme=' + graphTheme + '&hide_border=false&order=2';
      elements.streakGraphDaily.src = 'https://streak-stats.demolab.com?user=' + encodeURIComponent(username) + '&locale=en&mode=daily&theme=' + graphTheme + '&hide_border=false&border_radius=5&order=3';
      elements.streakGraphWeekly.src = 'https://streak-stats.demolab.com?user=' + encodeURIComponent(username) + '&locale=en&mode=weekly&theme=' + graphTheme + '&hide_border=false&border_radius=5&order=4';
      elements.trophyGraph.src = 'https://github-profile-trophy.vercel.app?username=' + encodeURIComponent(username) + '&theme=' + graphTheme + '&column=-1&row=1&margin-w=8&margin-h=8&no-frame=false&order=5';
      elements.activityGraph.src = 'https://github-readme-activity-graph.vercel.app/graph?username=' + encodeURIComponent(username) + '&bg_color=' + (theme === 'dark' ? '0f172a' : 'ffffff') + '&color=' + (theme === 'dark' ? 'f8fafc' : '0f172a') + '&line=3b82f6&point=3b82f6&area=true&hide_border=false';
      
      
      elements.copyUrl.classList.remove('hidden');
      elements.copyUrl.onclick = function() {
        const permanentUrl = window.location.origin + '/?username=' + encodeURIComponent(username);
        showPopup('<i class="fas fa-link"></i> Profile URL', false, permanentUrl, 'copy');
      };
      
      elements.downloadReport.classList.remove('hidden');
      elements.downloadReport.onclick = async () => {
        showPopup('<i class="fas fa-hourglass-half"></i> Saving report...', false, null, 'download');
        
        let downloadCancelled = false;
        elements.popupCancelButton.onclick = () => {
          downloadCancelled = true;
          closePopup();
        };
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (!downloadCancelled) {
          closePopup();
          try {
            window.print();
          } catch (err) {
            console.error('Print error', err);
            showPopup('<i class="fas fa-exclamation-triangle"></i> Failed to print report', false);
          }
        }
      };
    }
    
    function animateScore(targetScore) {
      const progressBar = elements.scoreProgress;
      const progressValue = elements.scoreText;
      const innerCircle = progressBar.querySelector('.inner-circle');
      let startValue = 0;
      const speed = 30;
      const progressColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim();
      
      const progress = setInterval(function() {
        startValue++;
        progressValue.textContent = startValue + '/100';
        progressBar.style.background = 'conic-gradient(' + progressColor + ' ' + (startValue * 3.6) + 'deg, ' + bgColor + ' 0deg)';
        
        if (startValue >= targetScore) {
          clearInterval(progress);
        }
      }, speed);
    }

    function showPopup(message, showStarButton, inputValue = null, popupType = 'default') {
      
      elements.starButton.classList.add('hidden');
      elements.starButton.style.display = 'none';
      elements.popupCopyButton.classList.add('hidden');
      elements.popupCancelButton.classList.add('hidden');
      elements.popupInputContainer.classList.add('hidden');
      
      
      elements.popupMessage.innerHTML = message.includes('starred')
        ? 'Please star the <a href="https://github.com/0xarchit/github-profile-analyzer" target="_blank" class="underline" style="color: var(--accent-primary);">0xarchit/github-profile-analyzer</a> repository to proceed. This helps us prevent abuse!'
        : message;
      
      const finalShowStarButton = (popupType === 'copy' || popupType === 'download') ? false : !!showStarButton;
      
      if (popupType === 'copy' && inputValue) {
        
        elements.popupInputContainer.classList.remove('hidden');
        elements.popupInput.value = inputValue;
        elements.popupCopyButton.classList.remove('hidden');
        elements.starButton.classList.add('hidden');
        elements.starButton.style.display = 'none';
        
        
        elements.popupCopyButton.onclick = () => {
          navigator.clipboard.writeText(inputValue).then(() => {
            elements.popupMessage.innerHTML = '<i class="fas fa-check-circle"></i> URL copied to clipboard!';
            setTimeout(() => {
              closePopup();
            }, 1500);
          });
        };
      } else if (popupType === 'download') {
        
        elements.popupCancelButton.classList.remove('hidden');
        
        elements.starButton.classList.add('hidden');
        elements.starButton.style.display = 'none';
      } else if (finalShowStarButton) {
        
        elements.starButton.classList.remove('hidden');
        
        elements.starButton.style.display = 'inline-block';
      }
      
      
      elements.popup.classList.remove('hidden');
      elements.popupOverlay.classList.remove('hidden');
    }
    
    function closePopup() {
      elements.popup.classList.add('hidden');
      elements.popupOverlay.classList.add('hidden');
      elements.popupInputContainer.classList.add('hidden');
      elements.starButton.classList.add('hidden');
      elements.starButton.style.display = 'none';
      elements.popupCopyButton.classList.add('hidden');
      elements.popupCancelButton.classList.add('hidden');
    }

    elements.popupClose.addEventListener('click', function() {
      closePopup();
    });
    
    elements.popupOverlay.addEventListener('click', function() {
      closePopup();
    });

    
    window.addEventListener('DOMContentLoaded', () => {
      const urlParams = new URLSearchParams(window.location.search);
      const initialUsername = urlParams.get('username');
      if (initialUsername) {
        elements.username.value = initialUsername;
        elements.analyze.click();
      }
    });
    
    
    async function refreshRateLimit() {
      try {
        const resp = await fetch('/rate_limit');
        if (!resp.ok) return;
        const { rate } = await resp.json();
        document.getElementById('rl-total').textContent = rate.limit;
        document.getElementById('rl-used').textContent = rate.used;
        document.getElementById('rl-remaining').textContent = rate.remaining;
      } catch (e) {
        console.error('Rate limit refresh error', e);
      }
    }
    
    
    document.addEventListener('DOMContentLoaded', function() {
      const widget = document.getElementById('rate-limit-widget');
      let isDragging = false, offsetX = 0, offsetY = 0;
      
      widget.addEventListener('mousedown', function(e) {
        isDragging = true;
        offsetX = e.clientX - widget.offsetLeft;
        offsetY = e.clientY - widget.offsetTop;
      });
      
      widget.addEventListener('touchstart', function(e) {
        e.preventDefault();
        isDragging = true;
        const touch = e.touches[0];
        offsetX = touch.clientX - widget.offsetLeft;
        offsetY = touch.clientY - widget.offsetTop;
      });
      
      document.addEventListener('mousemove', function(e) {
        if (isDragging) {
          widget.style.left = (e.clientX - offsetX) + 'px';
          widget.style.top = (e.clientY - offsetY) + 'px';
        }
      });
      
      document.addEventListener('touchmove', function(e) {
        if (isDragging) {
          e.preventDefault();
          const touch = e.touches[0];
          widget.style.left = (touch.clientX - offsetX) + 'px';
          widget.style.top = (touch.clientY - offsetY) + 'px';
        }
      }, { passive: false });
      
      document.addEventListener('mouseup', function() {
        isDragging = false;
      });
      
      document.addEventListener('touchend', function() {
        isDragging = false;
      });
      
      refreshRateLimit();
    });
  </script>
  <footer class="fixed bottom-0 w-full text-center p-3" style="background: var(--glass-bg); backdrop-filter: blur(10px); border-top: 1px solid var(--border-color);">
    <span style="color: var(--text-secondary);">© <a href="https://github.com/0xarchit/github-profile-analyzer/blob/main/LICENSE" class="underline" style="color: var(--accent-primary);">0xarchit</a> 2025</span>
  </footer>
</body>
</html>`;
}
