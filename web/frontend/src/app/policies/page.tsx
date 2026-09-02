import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/Nav";
import { Footer } from "@/components/marketing/Footer";
import { SUPPORT_EMAIL } from "@/lib/site";

/**
 * Terms and Privacy, together on one page at /policies.
 *
 * One page rather than two because they are read together and linked to
 * together, and because the interesting half of each — who is responsible for
 * telling staff they are monitored — only makes sense alongside the other.
 * Both documents keep their own `id`, so `/policies#privacy` still lands
 * exactly where a privacy link is expected to land.
 *
 * Everything stated here is checked against what the product actually does:
 * the collection list mirrors `components/marketing/Transparency.tsx`, which
 * in turn mirrors the first-run consent screen in `desktop/src/Consent.tsx`.
 * That screen is the source of truth. If this page and that screen ever
 * disagree, this page is the bug.
 *
 * ── THE THREE THINGS THAT NEED A HUMAN ──────────────────────────────────────
 * `LEGAL_ENTITY`, `JURISDICTION` and `LAST_UPDATED` are the only values here
 * that cannot be derived from the codebase. Set them to the real registered
 * company, the law the contract runs under, and the date this text was last
 * actually changed — not the date of the last deploy.
 */
const LEGAL_ENTITY = "Wendy Love Media";
const JURISDICTION = "the Federal Republic of Nigeria";
const LAST_UPDATED = "2 September 2026";

export const metadata: Metadata = {
  title: "Policies · TraxStaff",
  description:
    "The terms you agree to when you use TraxStaff, and exactly what the apps record, what they never record, and who can see it.",
  alternates: { canonical: "/policies" },
};

const termsToc = [
  { id: "t-agreement", label: "1. This agreement" },
  { id: "t-service", label: "2. What TraxStaff is" },
  { id: "t-accounts", label: "3. Accounts and workspaces" },
  { id: "t-employer", label: "4. If you are the employer" },
  { id: "t-acceptable", label: "5. Acceptable use" },
  { id: "t-availability", label: "6. Availability and changes" },
  { id: "t-fees", label: "7. Fees" },
  { id: "t-ip", label: "8. Ownership" },
  { id: "t-termination", label: "9. Ending the agreement" },
  { id: "t-liability", label: "10. Disclaimers and liability" },
  { id: "t-law", label: "11. Governing law" },
];

const privacyToc = [
  { id: "p-roles", label: "12. Who is responsible" },
  { id: "p-collect", label: "13. What we record" },
  { id: "p-never", label: "14. What we never record" },
  { id: "p-google", label: "15. Sign in with Google" },
  { id: "p-use", label: "16. How we use it" },
  { id: "p-share", label: "17. Who else touches it" },
  { id: "p-retention", label: "18. How long we keep it" },
  { id: "p-security", label: "19. Security" },
  { id: "p-rights", label: "20. Your rights" },
  { id: "p-children", label: "21. Children" },
  { id: "p-changes", label: "22. Changes" },
  { id: "p-contact", label: "23. Contact" },
];

const sections = [
  { id: "terms", label: "Terms & Conditions", toc: termsToc },
  { id: "privacy", label: "Privacy Policy", toc: privacyToc },
];

/* ── Small presentational pieces ──────────────────────────────────────────── */

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      // scroll-mt clears the fixed nav so an anchored heading isn't hidden under it.
      className="mt-20 scroll-mt-28 font-heading text-3xl font-bold tracking-[-0.02em] text-ink first:mt-0 sm:text-4xl"
    >
      {children}
    </h2>
  );
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mt-12 scroll-mt-28 font-heading text-xl font-bold tracking-[-0.01em] text-ink">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-[15px] leading-relaxed text-muted">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-4 space-y-2.5">{children}</ul>;
}

function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-5 text-[15px] leading-relaxed text-muted">
      <span aria-hidden className="absolute left-0 top-[0.6em] h-1.5 w-1.5 rounded-full bg-accent" />
      {children}
    </li>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

/** A pulled-out point that matters more than the paragraphs around it. */
function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-xl border border-border bg-surface p-5">
      <p className="text-[15px] leading-relaxed text-ink">{children}</p>
    </div>
  );
}

function MailLink() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-accent underline underline-offset-2">
      {SUPPORT_EMAIL}
    </a>
  );
}

export default function PoliciesPage() {
  const currentYear = new Date().getFullYear();

  return (
    <main className="mk-page min-h-screen bg-canvas">
      <MarketingNav />

      {/* Header band on the deep marketing field, so the page opens with the
          same weight as the site's other non-hero sections rather than starting
          cold on the canvas directly under the nav. */}
      <header className="mk-on-field bg-field-deep pb-16 pt-32 text-white sm:pb-20 sm:pt-40">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">Legal</p>
          <h1 className="mt-4 max-w-3xl font-heading text-4xl font-bold tracking-[-0.03em] sm:text-5xl lg:text-6xl">
            Policies
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            The terms you agree to when you use TraxStaff, and exactly what the
            apps record, what they never record, and who can see it. Written to
            be read, not to be skipped.
          </p>
          <p className="mt-6 text-sm text-white/40">Last updated {LAST_UPDATED}</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
        <div className="lg:grid lg:grid-cols-[230px_1fr] lg:gap-16">
          {/* Contents. Plain anchors — no scroll-spy, so this stays a server
              component and works with JavaScript off. */}
          <nav aria-label="Contents" className="mb-14 lg:mb-0">
            <div className="lg:sticky lg:top-28">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                Contents
              </div>
              <ul className="mt-4 border-l border-border pl-4">
                {sections.map((s, i) => (
                  <li key={s.id} className={i > 0 ? "mt-5" : ""}>
                    <a
                      href={`#${s.id}`}
                      className="block py-1 text-sm font-semibold text-ink transition hover:text-accent"
                    >
                      {s.label}
                    </a>
                    <ul className="mt-1 space-y-0.5">
                      {s.toc.map((t) => (
                        <li key={t.id}>
                          <a
                            href={`#${t.id}`}
                            className="block py-0.5 text-[13px] leading-snug text-muted transition hover:text-accent"
                          >
                            {t.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <article className="max-w-2xl">
            {/* ── TERMS ──────────────────────────────────────────────────── */}
            <H2 id="terms">Terms &amp; Conditions</H2>
            <P>
              These terms are a contract between {LEGAL_ENTITY} (&ldquo;we&rdquo;,
              &ldquo;us&rdquo;, TraxStaff) and whoever uses TraxStaff: both the
              organisation that signs up and each person who signs in. Using
              the apps or the dashboard means you accept them.
            </P>

            <H3 id="t-agreement">1. This agreement</H3>
            <P>
              TraxStaff is sold to organisations, not to individuals. Where an
              organisation has agreed a separate written contract with us, that
              contract wins wherever the two disagree; these terms fill in
              everything it does not cover.
            </P>

            <H3 id="t-service">2. What TraxStaff is</H3>
            <P>
              TraxStaff records how long people spend working, against the
              projects and tasks their organisation has set up. It runs as a
              desktop app for Windows and Linux, a mobile app for Android and
              iOS, and a web dashboard. What each of those records is set out in
              the privacy policy below.
            </P>
            <Callout>
              TraxStaff is deliberately visible. The desktop app shows an
              always-on indicator while it is recording, every staff member must
              accept a consent screen before capture can start, and there is no
              hidden or background mode. Do not deploy TraxStaff to anyone who
              has not been told they are being monitored.
            </Callout>

            <H3 id="t-accounts">3. Accounts and workspaces</H3>
            <UL>
              <LI>
                Accounts are created by invitation from an organisation
                administrator. There is no public sign-up.
              </LI>
              <LI>
                You are responsible for what happens under your account. Keep
                your password and your devices secure, and tell us at{" "}
                <MailLink /> if you think someone else has access.
              </LI>
              <LI>
                Administrators can invite, disable and remove members, and can
                see the tracked time, screenshots and activity of the people in
                their organisation.
              </LI>
              <LI>
                We may suspend an account or a whole workspace where we have to:
                unpaid fees, a security problem, or a use of the service
                that breaks section 5.
              </LI>
            </UL>

            <H3 id="t-employer">4. If you are the employer</H3>
            <P>
              This is the part of these terms that matters most. If you are the
              organisation deploying TraxStaff, then in data-protection terms{" "}
              <Strong>you decide</Strong> what is recorded about your staff and
              why. We provide the tool and hold the data for you. That makes you
              responsible for:
            </P>
            <UL>
              <LI>
                <Strong>Telling your staff.</Strong> Clearly, in advance, and in
                writing. The consent screen in our app is not a substitute for
                your own notice.
              </LI>
              <LI>
                <Strong>Having a lawful reason.</Strong> Monitoring staff is
                regulated in most countries. Whether you need consent, a
                legitimate-interests assessment, works-council agreement or
                something else is a question about your jurisdiction and your
                employment contracts, not about our software.
              </LI>
              <LI>
                <Strong>Configuring it proportionately.</Strong> Screenshot
                frequency, blurring and what gets tracked are settings you
                control. Choose the least intrusive configuration that meets
                your actual purpose.
              </LI>
              <LI>
                <Strong>Answering your staff.</Strong> Requests to see, correct
                or delete tracking data come to you first; see section 20.
              </LI>
            </UL>
            <P>
              You agree to indemnify us against claims brought by your staff
              arising from your failure to do the above. We cannot advise you on
              employment or data-protection law in your country; get your
              own advice before you roll TraxStaff out.
            </P>

            <H3 id="t-acceptable">5. Acceptable use</H3>
            <P>You must not:</P>
            <UL>
              <LI>
                Deploy TraxStaff covertly, or to anyone who has not been told
                they are being monitored.
              </LI>
              <LI>
                Install it on a device belonging to someone who is not a member
                of your organisation, or use it to monitor family members,
                partners or children.
              </LI>
              <LI>
                Tamper with the tracking data, the app, or the record of how
                time was captured, or attempt to defeat the
                tamper-evidence that makes those records worth anything.
              </LI>
              <LI>
                Reverse-engineer, resell or rebrand the service, or use it to
                build a competing product.
              </LI>
              <LI>
                Break the law with it, or use it to break into, overload or
                probe our systems or anybody else&rsquo;s.
              </LI>
            </UL>

            <H3 id="t-availability">6. Availability and changes</H3>
            <P>
              We work to keep TraxStaff running, but we do not promise it will
              never be unavailable. We may change, add or withdraw features. If
              we withdraw something an organisation is materially relying on, we
              will give reasonable notice where we can.
            </P>

            <H3 id="t-fees">7. Fees</H3>
            <P>
              Where fees apply, they are as agreed with your organisation. Fees
              are payable in advance and are non-refundable except where the law
              requires otherwise. We may change pricing with notice, effective
              from your next billing period.
            </P>

            <H3 id="t-ip">8. Ownership</H3>
            <P>
              We own TraxStaff: the software, the brand and everything in it. You own your data: the time records, screenshots, project
              names and everything else your organisation puts in or generates.
              You grant us only the permission we need to host, process and show
              that data back to you, and to keep backups of it.
            </P>

            <H3 id="t-termination">9. Ending the agreement</H3>
            <P>
              An organisation can stop using TraxStaff at any time. We can end
              the agreement for a material breach of these terms that is not put
              right within 30 days of us asking. On termination, access stops
              and your data is deleted on the schedule in section 18; export
              anything you need before you go.
            </P>

            <H3 id="t-liability">10. Disclaimers and liability</H3>
            <P>
              TraxStaff is provided as-is. We do not warrant that the tracking
              data is complete or accurate enough for any particular purpose,
              including payroll, billing, discipline or dismissal decisions.
            </P>
            <Callout>
              Tracked time is evidence, not proof. Do not make a decision that
              affects someone&rsquo;s job on a number from this app alone.
            </Callout>
            <P>
              To the fullest extent the law allows, we are not liable for
              indirect or consequential loss, lost profits, lost data, or claims
              brought by your staff. Our total liability for any claim is capped
              at what your organisation paid us in the twelve months before it
              arose. Nothing here excludes liability that cannot legally be
              excluded, including for death or personal injury caused by
              negligence, or for fraud.
            </P>

            <H3 id="t-law">11. Governing law</H3>
            <P>
              These terms are governed by the laws of {JURISDICTION}, and its
              courts have exclusive jurisdiction over any dispute. If you are a
              consumer, this does not take away rights you have under the law of
              the country you live in.
            </P>

            {/* ── PRIVACY ────────────────────────────────────────────────── */}
            <H2 id="privacy">Privacy Policy</H2>
            <P>
              TraxStaff is a monitoring tool, so this is the most important page
              on this site. It says what the apps record, what they refuse to
              record, and who can see the result.
            </P>

            <H3 id="p-roles">12. Who is responsible for your data</H3>
            <P>
              If you use TraxStaff because your employer asked you to, then{" "}
              <Strong>your employer decides what is recorded about you</Strong>,
              and we hold it on their behalf. In GDPR terms they are the
              controller and we are the processor. Questions about why you are
              being monitored, or requests to delete your tracking history, go
              to your employer first; we cannot overrule them about their
              own organisation&rsquo;s data.
            </P>
            <P>
              For the marketing site, our newsletter and our support inbox, we
              are the controller and this policy applies to us directly.
            </P>

            <H3 id="p-collect">13. What we record</H3>
            <P>
              <Strong>Account information.</Strong> Your name, email address,
              your role in the organisation, and a password hash. If you sign in
              with Google, there is no password at all.
            </P>
            <P>
              <Strong>While the desktop tracker is running,</Strong> and only
              while it is running:
            </P>
            <UL>
              <LI>
                <Strong>Screenshots</Strong> of all your monitors, at the
                frequency your organisation sets, blurred if your organisation
                turns blurring on.
              </LI>
              <LI>
                <Strong>Activity level:</Strong> how often the keyboard
                and mouse are used. Timing and intensity only.
              </LI>
              <LI>
                <Strong>Apps and sites:</Strong> the names of the
                applications you use and the domains of the sites you visit.
              </LI>
              <LI>
                <Strong>Device:</Strong> an identifier for the machine,
                so tracked time is attributed to the right one.
              </LI>
              <LI>
                <Strong>Time records:</Strong> when sessions started and
                stopped, against which project and task, and the integrity
                information used to detect whether a record was altered
                afterwards.
              </LI>
            </UL>
            <P>
              <Strong>On mobile,</Strong> only the time records. See section 14.
            </P>
            <P>
              <Strong>Technical information.</Strong> Ordinary server logs (IP
              address, app version, timestamps), kept for security and
              debugging.
            </P>

            <H3 id="p-never">14. What we never record</H3>
            <UL>
              <LI>
                <Strong>What you type.</Strong> Keystrokes are never captured.
                We record that input happened, never its content. TraxStaff is
                not a keylogger.
              </LI>
              <LI>
                <Strong>Full URLs.</Strong> The domain of a site, never the
                page, the path or the query string.
              </LI>
              <LI>
                <Strong>Anything after you stop.</Strong> Capture ends the
                moment you stop the timer or quit the app. There is no
                background mode.
              </LI>
              <LI>
                <Strong>Your phone&rsquo;s screen, activity or location.</Strong>{" "}
                The mobile apps take no screenshots, calculate no activity
                percentage and read no location. That is a product boundary, not
                a feature we have yet to build.
              </LI>
              <LI>
                <Strong>Anything we sell.</Strong> We do not sell personal data,
                and we do not use your tracking data for advertising or to train
                machine-learning models.
              </LI>
            </UL>

            <H3 id="p-google">15. Sign in with Google</H3>
            <P>
              If you sign in with Google, Google tells us three things: your
              email address, your name, and an identifier for your Google
              account. We use them only to match you to the TraxStaff account
              your organisation already invited.
            </P>
            <P>
              We ask for no other permission. We cannot read your Gmail, your
              contacts, your calendar or your files, and we never receive your
              Google password. Signing in with Google creates nothing on its own;
              if nobody has invited your address, there is no account
              for it to reach. You can revoke our access at any time from your
              Google account&rsquo;s security settings and go back to using a
              password.
            </P>

            <H3 id="p-use">16. How we use it</H3>
            <UL>
              <LI>
                To run the service: showing your organisation the
                reports, screenshots and activity it configured.
              </LI>
              <LI>
                To send the emails the service depends on: invitations, password
                resets, and the digests your organisation switched on. Each
                member can turn the optional ones off.
              </LI>
              <LI>To keep the service secure, detect abuse, and debug faults.</LI>
              <LI>To meet our legal obligations.</LI>
            </UL>

            <H3 id="p-share">17. Who else touches it</H3>
            <P>
              We use a small number of infrastructure providers to run
              TraxStaff. They process data on our instructions and cannot use it
              for their own purposes:
            </P>
            <UL>
              <LI>
                <Strong>Cockroach Labs:</Strong> the database holding
                accounts, projects and time records.
              </LI>
              <LI>
                <Strong>Cloudflare:</Strong> object storage for
                screenshots.
              </LI>
              <LI>
                <Strong>Render</Strong> and <Strong>Vercel:</Strong>
                hosting for the API and the web dashboard.
              </LI>
              <LI>
                <Strong>Our email provider:</Strong> delivery of
                invitations, resets and digests.
              </LI>
              <LI>
                <Strong>Google:</Strong> only if you choose to sign in
                with Google.
              </LI>
            </UL>
            <P>
              Beyond those, we share data only where the law requires it, or
              where a business transfer means someone else takes over running
              the service, in which case this policy travels with it.
            </P>
            <P>
              These providers run in data centres outside your country, so your
              data will cross borders. We rely on those providers&rsquo;
              standard contractual clauses and equivalent safeguards for the
              transfers.
            </P>

            <H3 id="p-retention">18. How long we keep it</H3>
            <UL>
              <LI>
                <Strong>Screenshots:</Strong> for the retention period
                your organisation sets, then deleted. An administrator can
                delete any screenshot immediately.
              </LI>
              <LI>
                <Strong>Time records and reports:</Strong> for as long as
                your organisation&rsquo;s account is open, since they are the
                record of work done.
              </LI>
              <LI>
                <Strong>Account information:</Strong> until the account
                is removed.
              </LI>
              <LI>
                <Strong>Server logs:</Strong> a short rolling window,
                then discarded.
              </LI>
            </UL>
            <P>
              When an organisation closes its account, we delete its data within
              90 days, except anything we are legally required to keep. Backups
              age out on their own cycle shortly after.
            </P>

            <H3 id="p-security">19. Security</H3>
            <P>
              Traffic is encrypted in transit. Passwords are stored hashed,
              never in plain text. Sessions expire, and disabling an account
              revokes access at the next request rather than whenever its
              session happens to run out. Every ordinary page in the dashboard
              defaults every role, administrators included, to seeing only their
              own data; organisation-wide visibility is opt-in
              and confined to the admin pages that exist for it.
            </P>
            <P>
              No system is perfectly secure. If you find a vulnerability, please
              tell us at <MailLink /> before telling anyone else.
            </P>

            <H3 id="p-rights">20. Your rights</H3>
            <P>
              Depending on where you live, you may have the right to see the
              personal data held about you, correct it, delete it, object to how
              it is used, or receive a copy of it.
            </P>
            <Callout>
              If you are a member of an organisation, exercise these rights with
              your employer; they control your tracking data. Contact us
              at <MailLink /> if they do not respond, or if your request is
              about data we hold as controller, such as the newsletter.
            </Callout>
            <P>
              We answer within one month. You can also complain to your local
              data-protection authority.
            </P>

            <H3 id="p-children">21. Children</H3>
            <P>
              TraxStaff is a workplace tool and is not for anyone under 16. We
              do not knowingly collect data from children. If you believe a
              child&rsquo;s data has reached us, tell us and we will delete it.
            </P>

            <H3 id="p-changes">22. Changes to these policies</H3>
            <P>
              We update this page when the product changes. The date at the top
              says when it last changed. If a change materially affects what we
              record or how we use it, we will tell organisation administrators
              by email before it takes effect.
            </P>

            <H3 id="p-contact">23. Contact</H3>
            <P>
              Questions about either document, or about the data we hold:{" "}
              <MailLink />.
            </P>

            <div className="mt-16 border-t border-border pt-8">
              <Link href="/" className="text-sm font-medium text-accent underline underline-offset-2">
                &lsaquo; Back to traxstaff.com
              </Link>
            </div>
          </article>
        </div>
      </div>

      <Footer currentYear={currentYear} />
    </main>
  );
}
