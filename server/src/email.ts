/**
 * Email Service - 使用 Resend 发送邮件
 */
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@dreamdiscover.top";

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY not set");
    }
    resend = new Resend(RESEND_API_KEY);
  }
  return resend;
}

/**
 * 发送登录验证码邮件
 */
export async function sendLoginCode(email: string, code: string): Promise<void> {
  const client = getResend();
  const { error } = await client.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "梦境录 - 你的登录验证码",
    html: `
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
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}
