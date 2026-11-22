import DOMPurify from "dompurify";
import { useGT } from "gt-react";

const startsWithHtml =
  /^\s*<(?:!doctype\s+html\b|!--|(?:html|head|body|meta|style|div|span|p|table|ul|ol|li|a|img|br|hr|pre|blockquote|h[1-6]|b|i|em|strong)(?=[\s/>]))/i;

function sanitizeEmail(body: string): string | undefined {
  // Some mail providers return HTML in the text body.
  if (!startsWithHtml.test(body)) return undefined;

  const fragment = DOMPurify.sanitize(body, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [
      "a",
      "b",
      "blockquote",
      "br",
      "caption",
      "code",
      "div",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "i",
      "li",
      "ol",
      "p",
      "pre",
      "s",
      "span",
      "strong",
      "sub",
      "sup",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
    ],
    ALLOWED_ATTR: ["href", "colspan", "rowspan"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
  });
  if (!fragment.textContent?.trim()) return "";
  for (const link of fragment.querySelectorAll("a[href]")) {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}

export function EmailMessageBody({ body }: { readonly body: string }) {
  const gt = useGT();
  const html = sanitizeEmail(body);
  if (html) {
    return (
      <div
        className="chat-markdown min-w-0 overflow-x-auto text-sm leading-relaxed wrap-anywhere select-text [&_a]:text-primary [&_a]:underline"
        dir="auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <p className="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap select-text" dir="auto">
      {(html === undefined && body) || gt("No message text available.")}
    </p>
  );
}
