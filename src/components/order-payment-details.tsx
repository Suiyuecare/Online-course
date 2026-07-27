"use client";

import { useState } from "react";

type PaymentDetails = {
  orderNumber: string;
  amountDueTwd: number;
  amountPaidTwd: number;
  bankName: string;
  bankCode: string;
  accountName: string;
  accountNumber: string;
  transferDueAt: string;
};

export function OrderPaymentDetails({ order }: { order: PaymentDetails }) {
  const [message, setMessage] = useState("");

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label}已複製。`);
    } catch {
      setMessage(`無法自動複製${label}，請長按文字後選擇複製。`);
    }
  }

  const amount = String(order.amountDueTwd);
  const all = [
    `訂單編號：${order.orderNumber}`,
    `應匯金額：NT$ ${amount}`,
    `銀行：${order.bankName}（${order.bankCode}）`,
    `戶名：${order.accountName}`,
    `帳號：${order.accountNumber}`,
  ].join("\n");

  return (
    <>
      <dl className="payment-instructions">
        <div>
          <dt>訂單編號</dt>
          <dd>
            {order.orderNumber}
            <button
              className="copy-button"
              onClick={() => void copy("訂單編號", order.orderNumber)}
              type="button"
            >
              複製
            </button>
          </dd>
        </div>
        <div>
          <dt>應匯金額</dt>
          <dd>
            NT$ {order.amountDueTwd.toLocaleString("zh-TW")}
            <button
              className="copy-button"
              onClick={() => void copy("應匯金額", amount)}
              type="button"
            >
              複製
            </button>
          </dd>
        </div>
        {order.amountPaidTwd > 0 && (
          <div>
            <dt>已核對金額</dt>
            <dd>NT$ {order.amountPaidTwd.toLocaleString("zh-TW")}</dd>
          </div>
        )}
        <div>
          <dt>銀行／代碼</dt>
          <dd>
            {order.bankName}（{order.bankCode}）
          </dd>
        </div>
        <div>
          <dt>戶名</dt>
          <dd>{order.accountName}</dd>
        </div>
        <div>
          <dt>帳號</dt>
          <dd>
            {order.accountNumber}
            <button
              className="copy-button"
              onClick={() => void copy("匯款帳號", order.accountNumber)}
              type="button"
            >
              複製
            </button>
          </dd>
        </div>
        <div>
          <dt>匯款期限</dt>
          <dd>{new Date(order.transferDueAt).toLocaleString("zh-TW")}</dd>
        </div>
      </dl>
      <button
        className="button secondary"
        onClick={() => void copy("全部匯款資料", all)}
        type="button"
      >
        複製全部匯款資料
      </button>
      <p aria-live="polite" className="form-message">
        {message}
      </p>
    </>
  );
}
