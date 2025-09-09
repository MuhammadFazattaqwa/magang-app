// /lib/reportTemplates.ts
export const TEMPLATE_MAP: Record<string, string> = {
  "Template BCA": "Template_BCA.docx",
  "Template Mandiri": "Template_Mandiri.docx",
  "Template BNI": "Template_BNI.docx",
  "Template CCTV RTRW": "Template_CCTV_RTRW.docx"
};

export function resolveTemplateFile(templateName?: string | null) {
  if (!templateName) throw new Error("Project belum memiliki report_template");
  const file = TEMPLATE_MAP[templateName];
  if (!file) throw new Error(`Template "${templateName}" belum dipetakan di TEMPLATE_MAP`);
  return file;
}
