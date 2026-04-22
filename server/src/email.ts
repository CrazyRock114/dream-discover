/**
 * Email Service - 使用 SMTP 发送邮件
 * 支持阿里云邮件推送、QQ邮箱、Gmail 等任意 SMTP 服务
 */
import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      throw new Error("SMTP config not set (SMTP_HOST, SMTP_USER, SMTP_PASS)");
    }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * 发送登录验证码邮件
 */
export async function sendLoginCode(email: string, code: string): Promise<void> {
  const client = getTransporter();
  await client.sendMail({
    from: `"梦境录" <${FROM_EMAIL}>`,
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
}
