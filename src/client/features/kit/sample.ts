/** Fixture data for the component gallery. */

export const SAMPLE_JOB_HTML = `
<p><strong>Northwind Labs</strong> builds scheduling software used by 4,000 clinics. We are a remote-first team of 60 across Europe and the Americas, and we are hiring a <em>Senior Frontend Engineer</em> to lead work on our patient booking flow.</p>
<h3>What you will do</h3>
<ul>
  <li>Own the booking experience end to end, from design review to production metrics.</li>
  <li>Build accessible, fast interfaces in React and TypeScript, and help us retire a legacy Angular app.</li>
  <li>Work with product and design on discovery: you will talk to clinic staff every month.
    <ul><li>Run usability sessions with our research lead.</li><li>Turn findings into a prioritised plan.</li></ul>
  </li>
  <li>Mentor two mid-level engineers and review their work.</li>
</ul>
<h3>What we are looking for</h3>
<ol>
  <li>5+ years building production web applications.</li>
  <li>Deep knowledge of React, TypeScript and modern CSS.</li>
  <li>Experience with design systems and WCAG 2.2 AA.</li>
</ol>
<blockquote>We care more about how you approach problems than about where you learned to code.</blockquote>
<h4>Compensation</h4>
<table>
  <thead><tr><th>Level</th><th>Base salary</th><th>Equity</th></tr></thead>
  <tbody>
    <tr><td>Senior</td><td>$140,000 – $165,000</td><td>0.05%</td></tr>
    <tr><td>Staff</td><td>$165,000 – $190,000</td><td>0.1%</td></tr>
  </tbody>
</table>
<p>Our stack: <code>React 19</code>, <code>TypeScript</code>, <code>Vite</code>, <code>PostgreSQL</code>. A typical config looks like:</p>
<pre><code>export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
});</code></pre>
<hr>
<h5>How to apply</h5>
<p>Send your CV and, if you like, a short note about a project you are proud of. Questions? Read our <a href="https://example.com/handbook">public handbook</a> or email <a href="mailto:jobs@example.com">jobs@example.com</a>. A very long link should wrap rather than overflow: <a href="https://example.com/careers/engineering/frontend/senior-frontend-engineer-booking-flow-remote-europe-americas">https://example.com/careers/engineering/frontend/senior-frontend-engineer-booking-flow-remote-europe-americas</a></p>
`;

export interface TitleOption {
  title: string;
  count: number;
}

export const TITLES: TitleOption[] = [
  { title: 'Frontend Engineer', count: 1284 },
  { title: 'Senior Frontend Engineer', count: 642 },
  { title: 'Full Stack Engineer', count: 2310 },
  { title: 'Software Engineer', count: 8120 },
  { title: 'Product Designer', count: 905 },
  { title: 'Product Manager', count: 1473 },
  { title: 'Data Engineer', count: 1102 },
  { title: 'Data Scientist', count: 731 },
  { title: 'Engineering Manager', count: 488 },
  { title: 'DevOps Engineer', count: 652 },
  { title: 'Site Reliability Engineer', count: 377 },
  { title: 'Mobile Engineer (iOS)', count: 214 },
  { title: 'Machine Learning Engineer', count: 559 },
  { title: 'Technical Writer', count: 96 },
];

export const PLACES = ['Remote', 'Berlin, Germany', 'Barcelona, Spain', 'Boston, MA', 'London, United Kingdom', 'Lisbon, Portugal', 'Toronto, Canada', 'Austin, TX', 'Amsterdam, Netherlands', 'New York, NY'];

export const SKILLS = ['TypeScript', 'JavaScript', 'React', 'React Native', 'Node.js', 'GraphQL', 'PostgreSQL', 'Python', 'Go', 'Rust', 'Kubernetes', 'Terraform', 'AWS', 'Figma', 'Accessibility', 'Design systems', 'Testing', 'Vite'];

/** A pretend network call: filters `items` after a short delay and honours aborts like fetch does. */
export function fakeLoader<T>(items: readonly T[], label: (item: T) => string, delayMs = 280) {
  return (query: string, signal: AbortSignal): Promise<T[]> =>
    new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const needle = query.toLowerCase();
        resolve(items.filter((item) => label(item).toLowerCase().includes(needle)).slice(0, 8));
      }, delayMs);
      signal.addEventListener('abort', () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
}
