"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { normalize, statuses, type OpportunityDetails, type ResearchResult } from "../lib/schema";

type Row = {
  id: string; teamKey: string; details: OpportunityDetails; source: string; owner: string;
  contact: string; role: string; status: string; originalSubject: string; originalBody: string;
  subject: string; body: string; revision: number; reviewer: string | null;
  approvedAt: string | null; lastContact: string | null;
};
type Run = {
  id: string; status: string; source: string; remoteId: string | null; error: string | null;
  createdAt: string; result: ResearchResult | null;
};
type Company = {
  id: string; name: string; website: string; contact: string; role: string; owner: string;
  permission: boolean; connection: string; latestRunId: string | null; resultsRunId: string | null;
  firstTeam: string | null; opportunities: Row[]; runs: Run[];
};
type Data = {
  companies: Company[]; estimate: string | null; id?: string; duplicate?: boolean;
  runId?: string; prompt?: string; outcome?: string;
};
type Act = (command: Record<string, unknown>) => Promise<Data | undefined>;
type Notify = (value: string) => void;

const endpoint = "/api/workspace";
const date = (s: string | null) => s ? new Date(s).toLocaleDateString() : "—";
const timestamp = (s: string | null) => s ? new Date(s).toLocaleString() : "—";

async function getData(command?: Record<string, unknown>): Promise<Data> {
  const response = await fetch(endpoint, command ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
  } : { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load the workspace.");
  return data;
}

export default function Workspace() {
  const [data, setData] = useState<Data>();
  const [view, setView] = useState<"Companies" | "Tracker">("Companies");
  const [selected, setSelected] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trackerStatus, setTrackerStatus] = useState("");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [pollIssue, setPollIssue] = useState<string>();
  const mutationVersion = useRef(0);

  useEffect(() => {
    let active = true;
    getData().then((value) => { if (active) setData(value); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [reload]);

  const act: Act = async (command) => {
    mutationVersion.current += 1;
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await getData(command);
      setData(value);
      return value;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the workspace.");
    } finally {
      setBusy(false);
    }
  };

  const companies = data?.companies ?? [];
  const company = companies.find((c) => c.id === selected) ?? companies[0];
  const processingRunId = company?.runs.find((run) =>
    run.id === company.latestRunId && run.source === "Clay API" && run.status === "Processing"
  )?.id;

  useEffect(() => {
    if (!processingRunId || busy) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const version = mutationVersion.current;
    const isCurrent = () => active && version === mutationVersion.current;

    async function checkProgress() {
      if (!isCurrent()) return;
      let delay = 10_000;
      try {
        const value = await getData({ action: "poll", runId: processingRunId });
        if (!isCurrent()) return;
        setPollIssue(undefined);
        setData(value);
      } catch {
        if (!isCurrent()) return;
        setPollIssue(processingRunId);
        delay = 30_000;
      }
      timer = setTimeout(checkProgress, delay);
    }

    timer = setTimeout(checkProgress, 2_000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [processingRunId, busy]);

  const row = company?.opportunities.find((o) => o.id === editing);
  const tracker = companies.flatMap((c) => c.opportunities.map((o) => ({ row: o, company: c })));
  const sent = tracker.filter(({ row }) => ["Sent", "Replied"].includes(row.status)).length;
  const review = tracker.filter(({ row }) => ["Draft", "Needs Review"].includes(row.status)).length;
  const openCompany = (id: string, draft = "") => {
    setSelected(id); setEditing(draft); setAdding(false); setView("Companies");
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="mark">L</span><div><strong>Lumnus</strong><small>CONSULTING</small></div></div>
      <span className="nav-label">WORKSPACE</span>
      {(["Companies", "Tracker"] as const).map((tab) =>
        <button key={tab} className={view === tab ? "nav active" : "nav"} onClick={() => { setView(tab); setAdding(false); setEditing(""); }}>
          <span aria-hidden="true">{tab === "Companies" ? "▣" : "☷"}</span>{tab}
        </button>)}
    </aside>
    <main>
      <header className="top"><span>Workspace <span className="slash">/</span> <strong>{view}</strong></span><span className="mode">{data?.estimate ? "Clay API available" : "Manual research import"}</span></header>
      <div className="content">
        <div className="page-heading"><div><h1>{view === "Companies" ? "Outreach workspace" : "Outreach tracker"}</h1>
          <p>{view === "Companies" ? "Research companies, compare projects, and review outreach." : "See who’s been contacted and what’s ready for review."}</p></div>
          <button className="primary" disabled={!data || busy} onClick={() => { setAdding(true); setView("Companies"); setEditing(""); }}>＋ New company</button>
        </div>
        {error && <div role="alert" className="alert error">{error} {!data && <button onClick={() => { setError(""); setReload(reload + 1); }}>Reload</button>}</div>}
        {notice && <div role="status" className="alert">{notice}</div>}
        {!data && !error && <div className="panel empty" role="status">Loading workspace…</div>}
        {data && <div className="stats">
          <Stat label="Companies" value={companies.length} />
          <Stat label="Drafts to review" value={review} />
          <Stat label="Outreach sent or replied" value={sent} />
        </div>}
        {data && adding && <Intake busy={busy} cancel={() => setAdding(false)} onSave={async (input) => {
          const result = await act({ action: "company", input });
          if (result?.id) {
            openCompany(result.id);
            setNotice(result.duplicate ? "This company already exists. Its outreach history is below." : "Company saved.");
          }
        }} />}
        {data && !adding && view === "Companies" && (company ? <div className="companies">
          <div className="panel company-list"><h2>Companies</h2>
            {companies.map((item) => <button key={item.id} className={company.id === item.id ? "selected" : ""} onClick={() => openCompany(item.id)}>
              <span>{item.name}</span><small>{item.opportunities.length} teams</small></button>)}
          </div>
          <CompanyPanel key={company.id} company={company} estimate={data.estimate} act={act} busy={busy} pollDelayed={Boolean(processingRunId && pollIssue === processingRunId)}
            setNotice={setNotice} setError={setError} openDraft={setEditing} />
        </div> : <div className="panel empty">
          <div className="empty-icon" aria-hidden="true">▤</div><h2>Add your first company</h2>
          <p>Start with a company name. You can add a website, a contact, or a warm connection if you have one.</p>
          <button className="primary" onClick={() => setAdding(true)}>＋ New company</button>
        </div>)}
        {data && view === "Tracker" && <div className="panel">
          <div className="section-heading"><h2>All outreach</h2><div className="actions">
            <input aria-label="Search outreach" placeholder="Find a company, team, or contact" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select aria-label="Filter by status" value={trackerStatus} onChange={(e) => setTrackerStatus(e.target.value)}>
              <option value="">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </div></div>
          <Tracker rows={tracker.filter(({ company: c, row: o }) =>
            (!trackerStatus || o.status === trackerStatus) &&
            [c.name, o.details.team, o.contact].join(" ").toLowerCase().includes(query.trim().toLowerCase()))}
            all={tracker} open={openCompany} />
        </div>}
        {row && !adding && <Draft key={row.id + ":" + row.revision} company={company} row={row} all={tracker} act={act}
          busy={busy} notify={setNotice} report={setError} close={() => setEditing("")} />}
      </div>
    </main>
  </div>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat"><p>{label}</p><strong>{value}</strong></div>;
}

function Intake({ busy, cancel, onSave }: {
  busy: boolean; cancel: () => void; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input = Object.fromEntries(form);
    const website = String(input.website ?? "").trim();
    void onSave({ ...input, website: website && !/^https?:/i.test(website) ? "https://" + website : website, permission: form.has("permission") });
  }
  return <form className="panel intake" onSubmit={submit}>
    <h2>New company</h2><p className="muted">A company name is enough to get started.</p>
    <div className="form-grid">
      <label>Company name <input name="name" required maxLength={500} autoFocus placeholder="e.g. Costco" /></label>
      <label>Website <input name="website" placeholder="company.com" /></label>
      <label>Contact name <input name="contact" maxLength={200} /></label>
      <label>Contact role <input name="role" maxLength={200} /></label>
      <label>Outreach owner <input name="owner" maxLength={200} /></label>
      <label className="wide">Warm connection details <textarea name="connection" rows={3} maxLength={1500} placeholder="Describe the relationship and the wording you have permission to use." /></label>
      <label className="check wide"><input type="checkbox" name="permission" /> Permission to use these details in research and mention the connection in drafts</label>
    </div>
    <div className="actions"><button type="submit" className="primary" disabled={busy}>Save company</button><button type="button" onClick={cancel}>Cancel</button></div>
  </form>;
}

function CompanyPanel({ company: c, estimate, act, busy, pollDelayed, setNotice, setError, openDraft }: {
  company: Company; estimate: string | null; act: Act; busy: boolean; pollDelayed: boolean; setNotice: Notify; setError: Notify;
  openDraft: (id: string) => void;
}) {
  const run = c.runs.find((r) => r.id === c.latestRunId);
  const results = c.runs.find((r) => r.id === c.resultsRunId);
  const clayReady = run?.source === "Clay API" && run.status === "Complete" && run.id === results?.id;
  const clayRunning = run?.source === "Clay API" && run.status === "Processing";
  const opportunities = [...(results?.result?.opportunities ?? [])].sort((a, b) => a.rank - b.rank);
  const [prompt, setPrompt] = useState("");
  const [raw, setRaw] = useState("");
  const [approvedCost, setApprovedCost] = useState(false);

  const start = async (action: "manual" | "clay") => {
    if (action === "clay" && !approvedCost) return;
    if (run && ["Processing", "Awaiting import", "Submission unconfirmed", "Submitting"].includes(run.status) &&
      !window.confirm("Start a new run? The outstanding run will no longer update this company. A previous Clay submission may still consume credits.")) return;
    const response = await act({ action, companyId: c.id, replaces: c.latestRunId, estimate });
    if (response) { setPrompt(response.prompt ?? ""); setRaw(""); setApprovedCost(false); }
  };

  async function importResult(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { setError("Paste a valid JSON object."); return; }
    const response = await act({ action: "import", runId: run?.id, payload });
    if (!response) return;
    setNotice(response.outcome === "stale" ? "This run was superseded. Its results were ignored." : response.outcome === "duplicate" ? "These results were already recorded." : "Imported three opportunities. Review the evidence before approving a draft.");
    setRaw("");
  }

  return <div className="company-body">
    <div className="panel">
      <div className="section-heading"><div><h2>{c.name}</h2>
        <p className="muted">{[c.owner && `Owner: ${c.owner}`, c.contact, c.role].filter(Boolean).join(" · ") || "Company profile"}</p></div>
        {c.website && <a href={c.website} target="_blank" rel="noreferrer">Website ↗</a>}
      </div>
      {c.connection && <p className="connection">Warm connection {c.permission ? "· Permission granted" : "· Mention not permitted"}<br />{c.connection}</p>}
      <div className="research">
        <h3>Research</h3>
        <div className="research-status" role="status">
          {clayRunning ? <><Pill>Clay research in progress</Pill><p className="muted">{pollDelayed
            ? "Couldn’t check Clay’s status. The app will try again automatically."
            : "The app checks automatically and will show the report here when it’s ready."}</p></>
            : clayReady ? <><Pill accent>Clay report ready</Pill><p className="muted">Three opportunities are ready to review.</p></>
            : <p className="muted">{run ? `${run.source} · ${run.status}` : "No research run yet."}</p>}
        </div>
        {run?.remoteId && <p className="muted">Clay run <code>{run.remoteId}</code></p>}
        {run?.error && <p className={run.status === "Complete" ? "muted" : "inline-error"}>{run.error}</p>}
        {run?.status === "Submitting" && <p className="muted">If this status persists after a minute, check Clay’s Runs before starting again.</p>}
        <div className="actions">
          <button disabled={busy} onClick={() => void start("manual")}>{results ? "New manual research run" : "Prepare manual import"}</button>
          {clayReady && <a className="report-link" href="#opportunity-report">View Clay report</a>}
        </div>
        {estimate && <div className="clay-controls">
          <label className="check"><input type="checkbox" checked={approvedCost} onChange={(e) => setApprovedCost(e.target.checked)} /> I approve the estimated cost for one run · {estimate}</label>
          <button className="primary" disabled={busy || !approvedCost} onClick={() => void start("clay")}>Submit to Clay</button>
        </div>}
        {!estimate && <p className="muted">Use the prepared prompt in a web research tool, then paste its JSON. Imported evidence needs human review.</p>}
        {run?.status === "Awaiting import" && <form onSubmit={importResult} className="import-form">
          <h3>Manual JSON import</h3>
          {prompt ? <details><summary>Open research prompt</summary><textarea rows={7} readOnly value={prompt} aria-label="Research prompt" />
            <button type="button" onClick={() => void copyText(prompt, setNotice, setError)}>Copy prompt</button></details>
            : <button type="button" disabled={busy} onClick={async () => setPrompt((await act({ action: "prompt", runId: run.id }))?.prompt ?? "")}>Load research prompt</button>}
          <label>Research result JSON <textarea required rows={5} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder='{"opportunities": […]}' /></label>
          <button className="primary" disabled={busy || !raw.trim()}>Import JSON</button>
        </form>}
        {c.runs.length > 0 && <details className="run-history"><summary>Research history</summary>
          <ul>{c.runs.map((r) => <li key={r.id}>{timestamp(r.createdAt)} · {r.source} · {r.status}{r.id !== c.latestRunId && " · Earlier run"} <code>{r.id}</code></li>)}</ul>
        </details>}
      </div>
    </div>
    {results && <section id="opportunity-report">
      <div className="section-heading comparison"><div><h2>Compare opportunities</h2><p className="muted">{results.source} · {date(results.createdAt)}{results.id !== c.latestRunId && " · Previous results"}</p></div>
      {c.firstTeam && <button disabled={busy} onClick={() => void act({ action:"recommend", companyId:c.id, resultsId:results.id, team:null })}>Restore research ranking</button>}</div>
      <div className="cards">{opportunities.map((o) => {
        const row = c.opportunities.find((r) => r.teamKey === normalize(o.team));
        const first = c.firstTeam ? c.firstTeam === normalize(o.team) : o.rank === 1;
        return <article key={o.team} className="panel opportunity">
          <div className="actions"><Pill>Rank {o.rank}</Pill>{first && <Pill accent>{c.firstTeam ? "Consultant choice" : "Recommended first"}</Pill>}</div>
          <h3>{o.team}</h3><p className="muted">{o.teamBasis === "inferred" ? "Inferred function" : "Publicly named · reported by researcher"}</p>
          <h4>{o.project}</h4>
          <dl>
            <dt>Pilot deliverable</dt><dd>{o.pilot}</dd>
            <dt>Potential benefit</dt><dd>{o.benefit}</dd>
            <dt>Client data and access</dt><dd>{o.access}</dd>
            <dt>Suggested recipient</dt><dd>{o.recipientRole}</dd>
          </dl>
          <details><summary>Evidence and uncertainty</summary>
            <ul className="evidence">{o.evidence.map((e, i) => <li key={i}>
              <a href={e.url} target="_blank" rel="noreferrer">{new URL(e.url).hostname} ↗</a>
              <p>{e.fact}</p>{e.excerpt && <blockquote><small>Researcher-supplied excerpt</small><br />{e.excerpt}</blockquote>}
              <small>{e.retrieval === "reported_retrieved" ? "Retrieval reported · independent verification pending" : e.retrieval === "unavailable" ? "Source reported unavailable" : "Source not checked"}</small>
            </li>)}</ul>
            <dl><dt>Hypothesis</dt><dd>{o.hypothesis}</dd><dt>Verify before sending</dt><dd>{o.verificationNotes}</dd></dl>
          </details>
          <details><summary>Scores and ranking</summary>
            <dl>{Object.entries(o.scores).map(([label, score]) => <div key={label}><dt className="capitalize">{label} · {score.score}/5</dt><dd>{score.reason}</dd></div>)}
              <dt>Rank rationale</dt><dd>{o.rankReason}</dd></dl>
          </details>
          <div className="actions card-actions">{row && <button className="primary" onClick={() => openDraft(row.id)}>Review email</button>}
            {!first && <button disabled={busy} onClick={() => void act({ action:"recommend", companyId:c.id, resultsId:results.id, team:o.team })}>Choose first</button>}
          </div>
          {row && (row.details.project !== o.project || row.originalBody !== o.draft.body || row.originalSubject !== o.draft.subject) &&
            <details><summary>New research draft · saved outreach retained</summary><p className="draft-preview"><strong>{o.draft.subject}</strong>{"\n\n"}{o.draft.body}</p></details>}
        </article>;
      })}</div>
    </section>}
    <section className="panel"><div className="section-heading"><h2>Company outreach history</h2></div>
      <Tracker rows={c.opportunities.map((row) => ({ company:c, row }))} open={(_, id) => openDraft(id)} />
    </section>
  </div>;
}

function Pill({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return <span className={accent ? "pill accent" : "pill"}>{children}</span>;
}

type TrackRow = { company: Company; row: Row };
function duplicateLabel(item: TrackRow, all: TrackRow[]) {
  const contact = normalize(item.row.contact);
  const matches = all.filter(({ row, company }) => row.id !== item.row.id &&
    ((company.id === item.company.id && row.teamKey === item.row.teamKey) || (contact && normalize(row.contact) === contact)));
  return matches.length ? `Potential duplicate · ${matches.map((m) => `${m.company.name} / ${m.row.details.team} (${m.row.status})`).join(", ")}` : "";
}

function Tracker({ rows, all = rows, open }: { rows: TrackRow[]; all?: TrackRow[]; open: (company: string, id: string) => void }) {
  if (!rows.length) return <p className="table-empty muted">No outreach records to show.</p>;
  return <div className="table-wrap"><table>
    <thead><tr>{["Company / team", "Project", "Owner", "Contact / role", "Approval", "Status", "Last contact"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.map((item) => {
      const { company, row } = item;
      const duplicate = duplicateLabel(item, all);
      return <tr key={row.id}>
        <td><button className="text-button" onClick={() => open(company.id, row.id)}>{row.details.team}</button><small>{company.name}</small></td>
        <td>{row.details.project}</td><td>{row.owner || "—"}</td>
        <td>{row.contact || "—"}<small>{row.role}</small>{duplicate && <small className="warning">{duplicate}</small>}</td>
        <td>{row.approvedAt ? <>{row.reviewer}<small>{timestamp(row.approvedAt)}</small></> : "Pending"}</td>
        <td><Pill accent={row.status === "Approved"}>{row.status}</Pill></td><td>{date(row.lastContact)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

async function copyText(value: string, notify: Notify, report: Notify) {
  try { await navigator.clipboard.writeText(value); notify("Copied to clipboard."); }
  catch { report("Clipboard unavailable. Select and copy the text manually."); }
}

function Draft({ company, row, all, act, busy, notify, report, close }: {
  company: Company; row: Row; all: TrackRow[]; act: Act; busy: boolean;
  notify: Notify; report: Notify; close: () => void;
}) {
  const [subject, setSubject] = useState(row.subject);
  const [body, setBody] = useState(row.body);
  const [reviewer, setReviewer] = useState(row.reviewer ?? "");
  const [message, setMessage] = useState("");
  const changed = subject !== row.subject || body !== row.body;
  const editable = ["Draft", "Needs Review", "Approved"].includes(row.status);
  const duplicate = duplicateLabel({ company, row }, all);
  const update = async (command: Record<string, unknown>) => {
    const result = await act({ action: "opportunity", id: row.id, revision: row.revision, command });
    if (!result) setMessage("The update failed. Close the editor to see the workspace error.");
  };
  return <div className="overlay" onKeyDown={(e) => { if (e.key === "Escape" && !busy) close(); }}>
    <section className="panel editor" role="dialog" aria-modal="true" aria-labelledby="draft-heading">
      <div className="section-heading editor-heading"><div><h2 id="draft-heading">Review email</h2><p className="muted">{company.name} · {row.details.team} · {row.source}</p></div>
        <button aria-label="Close email editor" onClick={close} disabled={busy} autoFocus>✕</button></div>
      <div className="editor-body">
        {message && <p role="status" className="alert">{message}</p>}
        <Pill accent={row.status === "Approved"}>{row.status}</Pill>
        {row.approvedAt && <p className="muted">Approved by {row.reviewer} · {timestamp(row.approvedAt)}</p>}
        {duplicate && <p className="warning">{duplicate}</p>}
        <p className="muted">Verify before sending · {row.details.verificationNotes}</p>
        <label>Subject <input value={subject} onChange={(e) => setSubject(e.target.value)} readOnly={!editable} /></label>
        <label>Email <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} readOnly={!editable} /></label>
        <p className="muted">{body.trim().split(/\s+/).filter(Boolean).length} words{changed && row.status === "Approved" && " · Saving these edits resets approval"}</p>
        <details><summary>Original draft</summary><p className="draft-preview"><strong>{row.originalSubject}</strong>{"\n\n"}{row.originalBody}</p></details>
        {editable && <label>Reviewer <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={200} placeholder="Your name" /></label>}
        <div className="actions">
          {editable && changed && <button className="primary" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void update({kind:"edit", email:{subject, body}})}>Save edits</button>}
          {row.status === "Draft" && !changed && <button disabled={busy} onClick={() => void update({kind:"review"})}>Request review</button>}
          {editable && row.status !== "Approved" && !changed && <button className="primary" disabled={busy || !reviewer.trim()} onClick={() => void update({kind:"approve", reviewer, email:{subject,body}})}>Approve draft</button>}
          {row.status === "Approved" && !changed && <>
            <button className="primary" disabled={busy} onClick={() => void copyText(subject + "\n\n" + body, (s) => { notify(s); setMessage(s); }, setMessage)}>Copy approved draft</button>
            <button disabled={busy} onClick={() => { if (window.confirm("Confirm this email was sent manually.")) void update({kind:"sent"}); }}>Mark sent</button>
          </>}
          {row.status === "Replied" && <Pill>Reply logged</Pill>}
          {row.status === "Sent" && <button disabled={busy} onClick={() => void update({kind:"replied"})}>Mark replied</button>}
          {row.status !== "Closed" && !changed && <button disabled={busy} onClick={() => { if (window.confirm("Close this outreach record?")) void update({kind:"closed"}); }}>Close outreach</button>}
        </div>
      </div>
    </section>
  </div>;
}
