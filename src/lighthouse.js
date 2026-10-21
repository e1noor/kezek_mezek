export function parseLighthouseAssignment(text) {
  if (!/New Assignment Posted!/i.test(text || '')) return null;
  const read = label => {
    const line = String(text).split(/\r?\n/).find(item => new RegExp(`\\b${label}:`, 'i').test(item));
    return line?.split(new RegExp(`${label}:`, 'i')).slice(1).join(':').trim() || '';
  };
  const subject = read('Subject');
  const title = read('Assignment').replace(/\s+is due\s*$/i, '').trim();
  const instructor = read('Instructor');
  const due = read('Due Date');
  if (!subject || !title) return null;
  const submissionDueAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(due) ? due : null;
  return { subject, title, instructor, submissionDueAt };
}
