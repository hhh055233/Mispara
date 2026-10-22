module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const {
    ADMIN_PASSWORD,
    GITHUB_TOKEN,
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_BRANCH = "main",
    GITHUB_FILE_PATH = "index.html"
  } = process.env;

  if (
    !ADMIN_PASSWORD ||
    !GITHUB_TOKEN ||
    !GITHUB_OWNER ||
    !GITHUB_REPO
  ) {
    return res.status(500).json({
      error: "חסרים משתני סביבה ב-Vercel"
    });
  }

  const supplied = req.headers["x-admin-password"];

  if (
    typeof supplied !== "string" ||
    supplied.length !== ADMIN_PASSWORD.length
  ) {
    return res.status(401).json({
      error: "סיסמת מנהל שגויה"
    });
  }

  let mismatch = 0;

  for (let i = 0; i < ADMIN_PASSWORD.length; i++) {
    mismatch |=
      ADMIN_PASSWORD.charCodeAt(i) ^
      supplied.charCodeAt(i);
  }

  if (mismatch !== 0) {
    return res.status(401).json({
      error: "סיסמת מנהל שגויה"
    });
  }

  const html = req.body?.html;

  if (
    typeof html !== "string" ||
    !html.toLowerCase().startsWith("<!doctype html>") ||
    html.length > 900000
  ) {
    return res.status(400).json({
      error: "קובץ HTML לא תקין או גדול מדי"
    });
  }

  const path = GITHUB_FILE_PATH
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const url =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(GITHUB_OWNER)}/` +
    `${encodeURIComponent(GITHUB_REPO)}/contents/${path}`;

  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "barber-site-publisher"
  };

  try {
    // בדיקת הקובץ הקיים כדי לקבל SHA לעדכון
    const existing = await fetch(
      `${url}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
      { headers }
    );

    let sha;

    if (existing.ok) {
      const file = await existing.json();
      sha = file.sha;
    } else if (existing.status !== 404) {
      return res.status(502).json({
        error: "לא ניתן לקרוא את הקובץ הקיים ב-GitHub"
      });
    }

    // הכנת העדכון
    const payload = {
      message: "Update barber website from admin panel",
      content: Buffer.from(html, "utf8").toString("base64"),
      branch: GITHUB_BRANCH
    };

    if (sha) {
      payload.sha = sha;
    }

    // שליחת העדכון ל-GitHub
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: result.message || "עדכון GitHub נכשל"
      });
    }

    return res.status(200).json({
      success: true,
      commit: result.commit?.sha?.slice(0, 7) || null,
      message:
        "הקוד עודכן ב-GitHub. " +
        "Vercel אמור להתחיל פריסה אוטומטית."
    });

  } catch (error) {
    return res.status(500).json({
      error: "שגיאת תקשורת: " + error.message
    });
  }
};
