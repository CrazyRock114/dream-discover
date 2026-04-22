/**
 * Email Service - 使用阿里云邮件推送 HTTP API
 * 绕过 SMTP 端口限制，直接走 HTTP
 */
import Core from "@alicloud/pop-core";

const ALIYUN_ACCESS_KEY_ID = process.env.ALIYUN_ACCESS_KEY_ID || "";
const ALIYUN_ACCESS_KEY_SECRET = process.env.ALIYUN_ACCESS_KEY_SECRET || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";

let client: Core | null = null;

function getClient(): Core {
  if (!client) {
    if (!ALIYUN_ACCESS_KEY_ID || !ALIYUN_ACCESS_KEY_SECRET) {
      throw new Error("Aliyun AccessKey not set (ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET)");
    }
    client = new Core({
      accessKeyId: ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: ALIYUN_ACCESS_KEY_SECRET,
      endpoint: "https://dm.aliyuncs.com",
      apiVersion: "2015-11-23",
    });
  }
  return client;
}

/**
 * 发送登录验证码邮件
 */
export async function sendLoginCode(email: string, code: string): Promise<void> {
  const client = getClient();

  const params = {
    Action: "SingleSendMail",
    AccountName: FROM_EMAIL,
    AddressType: 1,
    ReplyToAddress: false,
    ToAddress: email,
    Subject: "梦境录 - 你的登录验证码",
    HtmlBody: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #A78BFA; margin-bottom: 24px;">🌙 梦境录</h2>
        <p style="color: #333; font-size: 16px; line-height: 1.6;">
          你正在登录梦境录，验证码如下：
        </p>
        <div style="background: #f5f3ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; color: #A78BFA; letter-spacing: 8px;">${code}</span>
        </div>
        <p style="color: #666; font-size: 14px; line-height: 1.6;">
          验证码 5 分钟内有效。如果你没有请求登录，请忽略此邮件。
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">
          梦境录 - 记录每一个梦，解读每一个谜
        </p>
      </div>
    `,
  };

  const requestOption = {
    method: "POST",
  };

  try {
    await client.request("SingleSendMail", params, requestOption);
  } catch (err: any) {
    console.error("[email] Aliyun send failed:", err.message || err);
    throw new Error(`发送邮件失败: ${err.message || err}`);
  }
}
