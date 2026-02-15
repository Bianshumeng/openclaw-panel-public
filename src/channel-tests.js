function withTimeout(promise, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    wrapped: promise(controller.signal).finally(() => clearTimeout(timer))
  };
}

export async function testTelegramBot(botToken) {
  if (!botToken) {
    return {
      ok: false,
      message: "botToken 不能为空"
    };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/getMe`;
    const { wrapped, signal } = withTimeout(
      (controllerSignal) =>
        fetch(url, {
          method: "GET",
          signal: controllerSignal
        }),
      8000
    );
    const response = await wrapped;
    const payload = await response.json();
    if (response.ok && payload.ok) {
      return {
        ok: true,
        message: `连接成功，机器人：${payload.result?.username || "unknown"}`
      };
    }
    return {
      ok: false,
      message: payload?.description || `请求失败（${response.status}）`
    };
  } catch (error) {
    return {
      ok: false,
      message: `连接失败：${error.message}`
    };
  }
}

export async function testFeishuBot(appId, appSecret) {
  if (!appId || !appSecret) {
    return {
      ok: false,
      message: "appId 和 appSecret 不能为空"
    };
  }

  try {
    const { wrapped } = withTimeout(
      (signal) =>
        fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            app_id: appId,
            app_secret: appSecret
          }),
          signal
        }),
      8000
    );
    const response = await wrapped;
    const payload = await response.json();
    if (response.ok && payload.code === 0 && payload.tenant_access_token) {
      return {
        ok: true,
        message: "飞书连接成功，凭证可用"
      };
    }
    return {
      ok: false,
      message: payload?.msg || `请求失败（${response.status}）`
    };
  } catch (error) {
    return {
      ok: false,
      message: `连接失败：${error.message}`
    };
  }
}

export async function testDiscordBot(token) {
  if (!token) {
    return {
      ok: false,
      message: "token 不能为空"
    };
  }

  try {
    const { wrapped } = withTimeout(
      (signal) =>
        fetch("https://discord.com/api/v10/users/@me", {
          method: "GET",
          headers: {
            authorization: `Bot ${token}`
          },
          signal
        }),
      8000
    );
    const response = await wrapped;
    const payload = await response.json();
    if (response.ok && payload?.id) {
      return {
        ok: true,
        message: `连接成功，机器人：${payload.username || payload.global_name || payload.id}`
      };
    }
    return {
      ok: false,
      message: payload?.message || payload?.error || `请求失败（${response.status}）`
    };
  } catch (error) {
    return {
      ok: false,
      message: `连接失败：${error.message}`
    };
  }
}

async function testSlackBotToken(botToken) {
  const { wrapped } = withTimeout(
    (signal) =>
      fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          authorization: `Bearer ${botToken}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: "",
        signal
      }),
    8000
  );
  const response = await wrapped;
  const payload = await response.json();
  if (response.ok && payload.ok) {
    return {
      ok: true,
      message: `Bot Token 可用，团队：${payload.team || "unknown"}`
    };
  }
  return {
    ok: false,
    message: payload?.error || `Bot Token 校验失败（${response.status}）`
  };
}

async function testSlackAppToken(appToken) {
  const { wrapped } = withTimeout(
    (signal) =>
      fetch("https://slack.com/api/apps.connections.open", {
        method: "POST",
        headers: {
          authorization: `Bearer ${appToken}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: "",
        signal
      }),
    8000
  );
  const response = await wrapped;
  const payload = await response.json();
  if (response.ok && payload.ok) {
    return {
      ok: true,
      message: "App Token 可用（Socket 链接可建立）"
    };
  }
  return {
    ok: false,
    message: payload?.error || `App Token 校验失败（${response.status}）`
  };
}

export async function testSlackBot({ mode, botToken, appToken, signingSecret }) {
  if (!botToken) {
    return {
      ok: false,
      message: "botToken 不能为空"
    };
  }

  if (mode === "http" && !signingSecret) {
    return {
      ok: false,
      message: "HTTP 模式需要 signingSecret"
    };
  }

  try {
    const botCheck = await testSlackBotToken(botToken);
    if (!botCheck.ok) {
      return botCheck;
    }

    if (mode === "socket") {
      if (!appToken) {
        return {
          ok: false,
          message: "Socket 模式需要 appToken"
        };
      }
      const appCheck = await testSlackAppToken(appToken);
      if (!appCheck.ok) {
        return appCheck;
      }
      return {
        ok: true,
        message: "Slack Socket 模式校验通过（Bot Token + App Token 均可用）"
      };
    }

    return {
      ok: true,
      message: "Slack HTTP 模式基础校验通过（Bot Token 可用，Signing Secret 已填写）"
    };
  } catch (error) {
    return {
      ok: false,
      message: `连接失败：${error.message}`
    };
  }
}
