export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    FIREBASE_WEB_API_KEY,
    ADMIN_UID,
    GITHUB_TOKEN,
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_BRANCH = "main"
  } = process.env;

  if (
    !FIREBASE_WEB_API_KEY ||
    !ADMIN_UID ||
    !GITHUB_TOKEN ||
    !GITHUB_OWNER ||
    !GITHUB_REPO
  ) {
    return res.status(500).json({
      error: "חסרות הגדרות שרת ב-Vercel. בדקו את משתני הסביבה."
    });
  }

  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!idToken) {
    return res.status(401).json({
      error: "נדרשת התחברות מנהל."
    });
  }

  try {
    // Verify the Firebase ID token with Firebase Identity Toolkit.
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        FIREBASE_WEB_API_KEY
      )}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ idToken })
      }
    );

    const verified = await verifyResponse.json();
    const account = verified.users && verified.users[0];

    if (
      !verifyResponse.ok ||
      !account ||
      account.localId !== ADMIN_UID
    ) {
      return res.status(403).json({
        error:
          "אין הרשאה לפרסם קוד. רק חשבון המנהל המוגדר יכול לבצע פעולה זו."
      });
    }

    const content = req.body && req.body.content;

    if (
      typeof content !== "string" ||
      content.length < 20 ||
      content.length > 900000
    ) {
      return res.status(400).json({
        error: "תוכן HTML חסר או גדול מדי."
      });
    }

    if (!/^\s*<!doctype html/i.test(content)) {
      return res.status(400).json({
        error: "יש לשלוח קובץ HTML מלא שמתחיל ב-DOCTYPE."
      });
    }

    const headers = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const path = "index.html";

    const apiBase =
      `https://api.github.com/repos/` +
      `${encodeURIComponent(GITHUB_OWNER)}/` +
      `${encodeURIComponent(GITHUB_REPO)}/contents/${path}`;

    const getFile = await fetch(
      `${apiBase}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
      { headers }
    );

    let sha;

    if (getFile.ok) {
      const old = await getFile.json();
      sha = old.sha;
    } else if (getFile.status !== 404) {
      const detail = await getFile.text();

      return res.status(502).json({
        error: `GitHub לא הצליח לקרוא את הקובץ (${getFile.status}). ${detail.slice(
          0,
          250
        )}`
      });
    }

    const commitResponse = await fetch(apiBase, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Update barber website from admin panel",
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {})
      })
    });

    const result = await commitResponse.json();

    if (!commitResponse.ok) {
      return res.status(502).json({
        error: `GitHub דחה את העדכון (${commitResponse.status}): ${(
          result.message || "Unknown error"
        ).slice(0, 250)}`
      });
    }

    return res.status(200).json({
      ok: true,
      commit:
        result.commit && result.commit.sha
          ? result.commit.sha.slice(0, 8)
          : "created"
    });
  } catch (error) {
    return res.status(500).json({
      error:
        "שגיאה בזמן הפרסום. בדקו את הגדרות GitHub ו-Vercel."
    });
  }
}
