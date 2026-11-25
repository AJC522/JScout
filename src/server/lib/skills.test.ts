import { describe, expect, it } from 'vitest';
import { canonicalSkill, extractSkills, normalizeSkillList, skillCategory, skillIndexBuildMs, suggestSkills } from './skills';

const has = (text: string, skill: string): boolean => extractSkills(text).includes(skill);

describe('extractSkills: names with symbols', () => {
  const cases: Array<[term: string, skill: string]> = [
    ['C++', 'C++'], ['C#', 'C#'], ['.NET', '.NET'], ['Node.js', 'Node.js'], ['Next.js', 'Next.js'], ['CI/CD', 'CI/CD'],
    ['A/B testing', 'A/B Testing'], ['Objective-C', 'Objective-C'], ['T-SQL', 'T-SQL'], ['PL/SQL', 'PL/SQL'],
    ['ASP.NET', 'ASP.NET'], ['Vue.js', 'Vue.js'], ['D3.js', 'D3.js'], ['OAuth 2.0', 'OAuth'], ['HTML5', 'HTML'],
    ['ES6', 'JavaScript'], ['S3', 'Amazon S3'], ['EC2', 'Amazon EC2'], ['K8s', 'Kubernetes'], ['M&A', 'Mergers and Acquisitions'],
    ['SOC 2', 'SOC 2'], ['ISO 27001', 'ISO 27001'], ['Six Sigma', 'Six Sigma'], ['CPR', 'CPR'], ['BLS', 'BLS'],
    ['ACLS', 'ACLS'], ['RN', 'Registered Nurse'], ['nodejs', 'Node.js'], ['NodeJS', 'Node.js'], ['ReactJS', 'React'],
    ['Golang', 'Go'], ['Postgres', 'PostgreSQL'], ['k8s', 'Kubernetes'], ['ML', 'Machine Learning'], ['LLMs', 'Large Language Models'],
  ];
  it.each(cases)('%s -> %s', (term, skill) => {
    expect(extractSkills(`Requirements: solid hands-on work with ${term} in production.`)).toContain(skill);
  });
  it('keeps symbol names whole in running text', () => {
    expect(extractSkills('We use C#/.NET, C++17 and Node.js (TypeScript) for CI/CD tooling.')).toEqual(
      expect.arrayContaining(['C#', '.NET', 'Node.js', 'TypeScript', 'CI/CD']),
    );
    expect(extractSkills('Strong C++ and C# skills')).toEqual(['C++', 'C#']);
    expect(extractSkills('Objective-C, Swift and iOS SDK experience')).toEqual(expect.arrayContaining(['Objective-C', 'Swift']));
  });
  it('does not produce false positives from symbol-bearing words', () => {
    const none = (text: string) => expect(extractSkills(text)).toEqual([]);
    // R&D is its own skill now; what matters is that neither R nor C fires.
    expect(extractSkills('Report to the C-suite and drive R&D initiatives.')).toEqual(['Research and Development']);
    none('Our customers include AT&T and Verizon.');
    // Owning a P&L is a real skill now (Profit and Loss Management); the point is that no single-letter skill fires.
    expect(extractSkills('You will own the P&L for the region.')).toEqual(['Profit and Loss Management']);
    none('We expect a swift response to customer issues.');
    none('You will excel at building relationships.');
    none('In a word, we move fast.');
    none('Our plant is in the rust belt.');
    none('Must be able to go on site.');
    none('We are a lean startup.');
    none('Work with Sales, Finance and Legal teams.');
    expect(extractSkills('Own our go-to-market strategy and go-live plans.')).toEqual(['Go-to-Market Strategy']);
  });
});

describe('extractSkills: common words that are also skill names', () => {
  const ordinary = [
    'Our head chef prepares meals daily.', 'Do not be a puppet of the process.', 'Ideas that spark joy.',
    'Bring a flask of coffee.', 'Express your ideas clearly.', 'Spring into action.', 'Make it happen.',
    'Unity of purpose matters here.', 'Access to the building is restricted.', 'Teams across the org rely on you.',
    'Sales grew 40% last year.', 'We run a lean operation.', 'Go above and beyond for customers.', 'Excel in a fast-paced environment.',
    'Word of mouth referrals are welcome.', 'Swift onboarding for new hires.', 'Rust and corrosion inspection of pipes.',
    'Pick up the slack when needed.', 'An agile mindset is valued.', 'Snowflake is our mascot.', 'Zoom in on the details.',
  ];
  it.each(ordinary)('%s', (text) => {
    expect(extractSkills(text)).toEqual([]);
  });
});

describe('extractSkills: ambiguous entries need list or skill context (both directions)', () => {
  // [skill, sentence where it is a skill, sentence where it is an ordinary word]
  const cases: Array<[string, string, string]> = [
    ['Go', 'Backend services are written in Go and Python.', 'Go the extra mile; we go above and beyond.'],
    ['R', 'Experience with R, SAS or SPSS is required.', 'Partner with our R&D group on new products.'],
    ['C', 'Proficient in C for embedded firmware.', 'Present quarterly results to the C-suite.'],
    ['Swift', 'Languages: Swift, Kotlin', 'Swift response times are essential.'],
    ['Rust', 'Tech stack: Rust and gRPC', 'Rust Belt manufacturing roots.'],
    ['Microsoft Excel', 'Advanced knowledge of Excel and PowerPoint.', 'Excel at building relationships.'],
    ['Microsoft Word', 'Proficient in Word, Excel and Outlook.', 'In a Word, we move fast.'],
    ['Microsoft Teams', 'Collaboration using Teams and Zoom daily.', 'Teams across the company rely on you.'],
    ['Microsoft Access', 'Experience with Access, SQL Server and Excel.', 'Access to the warehouse requires a badge.'],
    ['Apache Spark', 'Experience with Spark and Hadoop pipelines.', 'Spark curiosity in every customer.'],
    ['Flask', 'Python web frameworks such as Django or Flask.', 'Flask and beaker handling in the lab.'],
    ['Express.js', 'Node.js, Express, and MongoDB on the backend.', 'Express your ideas clearly and concisely.'],
    ['Spring', 'Experience with Java and Spring.', 'Spring and summer hours apply.'],
    ['Chef', 'Configuration management tools such as Ansible, Puppet or Chef.', 'Chef de partie position in our kitchen.'],
    ['Puppet', 'Configuration management with Puppet, Ansible and Terraform.', 'Puppet shows for the children on Fridays.'],
    ['Unity', 'Game engines: Unity, Unreal Engine', 'Unity and inclusion are our values.'],
    ['Make', 'Automation tools (Zapier, Make, n8n).', 'Make an impact from day one.'],
    ['Sales', '5 years of experience in Sales.', 'Work with Sales, Marketing and Product.'],
    ['Lean Manufacturing', 'Knowledge of Lean, Six Sigma and Kaizen.', 'Lean in to ambiguity.'],
    ['Slack', 'Tools: Slack, Notion, Jira', 'Slack time between shifts is paid.'],
    ['Agile', 'Experience with Agile and Scrum.', 'Agile thinkers wanted.'],
    ['Snowflake', 'Familiarity with Snowflake, BigQuery or Redshift.', 'Snowflake season starts in December.'],
    ['English', 'Languages: English, German', 'English breakfast is served on Fridays.'],
  ];
  it.each(cases)('%s', (skill, yes, no) => {
    expect(extractSkills(yes)).toContain(skill);
    expect(extractSkills(no)).not.toContain(skill);
  });
  it('requires the dictionary casing for single-word ambiguous names', () => {
    expect(has('Experience with go and python.', 'Go')).toBe(false);
    expect(has('Experience with excel.', 'Microsoft Excel')).toBe(false);
    // multi-word aliases match case-insensitively
    expect(has('experience with microsoft excel', 'Microsoft Excel')).toBe(true);
    expect(has('apache spark pipelines', 'Apache Spark')).toBe(true);
  });
  it('accepts bullet lists and skills-style headings', () => {
    const bullets = 'What you bring:\n- Python\n- Go\n- Rust\n\nPerks:\n- Go karting days';
    const found = extractSkills(bullets);
    expect(found).toEqual(expect.arrayContaining(['Python', 'Go', 'Rust']));
    expect(extractSkills('Skills: Go, Docker')).toEqual(['Go', 'Docker']);
    expect(extractSkills('Tools – Excel, Tableau')).toEqual(['Microsoft Excel', 'Tableau']);
  });
  it('accepts a list of three or more dictionary names even without an anchor', () => {
    expect(extractSkills('Microsoft Office products (Excel, Word, Teams and Outlook)')).toEqual(
      expect.arrayContaining(['Microsoft Excel', 'Microsoft Word', 'Microsoft Teams', 'Microsoft Outlook']),
    );
  });
});

describe('extractSkills: longest match wins, without overlaps', () => {
  it('prefers the longest name', () => {
    expect(extractSkills('JavaScript developer')).toEqual(['JavaScript']);
    expect(extractSkills('We run MySQL and PostgreSQL')).toEqual(['MySQL', 'PostgreSQL']);
    expect(extractSkills('React Native apps')).toEqual(['React Native']);
    expect(extractSkills('Ruby on Rails monolith')).toEqual(['Ruby on Rails']);
    expect(extractSkills('Spring Boot microservices')).toEqual(['Spring Boot', 'Microservices']);
    expect(extractSkills('Java and JavaScript')).toEqual(['Java', 'JavaScript']);
  });
  it('accepts harmless hyphen suffixes but not compounds', () => {
    expect(extractSkills('Python-based tooling')).toEqual(['Python']);
    expect(extractSkills('AWS-certified engineers')).toEqual(['Amazon Web Services']);
  });
});

describe('extractSkills: ranking and limits', () => {
  it('orders by prominence (first position, then frequency)', () => {
    expect(extractSkills('Python, SQL and Docker.')).toEqual(['Python', 'SQL', 'Docker']);
    const text = `Docker is nice. ${'Filler text about the company and its mission. '.repeat(20)} Kubernetes, Kubernetes, Kubernetes and Kubernetes. Terraform.`;
    const r = extractSkills(text);
    expect(r[0]).toBe('Docker');
    expect(r.indexOf('Kubernetes')).toBeLessThan(r.indexOf('Terraform'));
  });
  it('truncates after ranking and de-duplicates', () => {
    const text = 'Python, SQL, Docker, Kubernetes, Terraform. Python again. python. PYTHON.';
    expect(extractSkills(text, { limit: 2 })).toEqual(['Python', 'SQL']);
    expect(extractSkills(text, { limit: 0 })).toEqual([]);
    expect(new Set(extractSkills(text)).size).toBe(extractSkills(text).length);
  });
  it('ignores boilerplate sentences', () => {
    expect(extractSkills('We are an equal opportunity employer and do not discriminate on the basis of race, national origin or disability.')).toEqual([]);
    expect(extractSkills('See our EEO Policy and EEO is the Law poster.')).toEqual([]);
    expect(extractSkills('We offer a comprehensive total rewards package.')).toEqual([]);
    expect(extractSkills('You will design our Total Rewards programs.')).toEqual(['Total Rewards']);
    // Privacy notices name "audio" recordings and transcription; they are not what the job needs.
    expect(extractSkills('We collect these categories of personal information: Sensory Information (audio/video recording).')).toEqual([]);
    expect(extractSkills('In select roles, the interviews will be recorded, transcribed and summarized by AI.')).toEqual([]);
  });
  it('handles empty and odd input', () => {
    expect(extractSkills('')).toEqual([]);
    expect(extractSkills('   \n\t ')).toEqual([]);
    expect(extractSkills('+++ ### /// &&& ...')).toEqual([]);
    expect(extractSkills('C++C#.NET')).toEqual(expect.any(Array));
    expect(extractSkills('🚀 Python 🐍 and SQL')).toEqual(['Python', 'SQL']);
  });
});

describe('extractSkills: regressions found by attacking the matcher', () => {
  it('handles symbol lists', () => {
    expect(extractSkills('We use C#/.NET, C++17 and Node.js (TypeScript) for CI/CD tooling.')).toEqual(['C#', '.NET', 'C++', 'Node.js', 'TypeScript', 'CI/CD']);
    expect(extractSkills('Java/Kotlin and Go/Rust')).toEqual(['Java', 'Kotlin', 'Go', 'Rust']);
    expect(extractSkills('HTML/CSS/JS')).toEqual(['HTML', 'CSS', 'JavaScript']);
    expect(extractSkills('AWS/GCP/Azure')).toEqual(['Amazon Web Services', 'Google Cloud Platform', 'Microsoft Azure']);
    expect(extractSkills('C/C++')).toEqual(['C', 'C++']);
  });
  it('treats iOS/Android as skills only in skill context', () => {
    expect(extractSkills('Experience with iOS and Android development.')).toEqual(['iOS Development', 'Android Development']);
    expect(extractSkills('You must own an iOS or Android smartphone.')).toEqual([]);
  });
  it('stays linear on long single-line input full of ambiguous words', () => {
    for (const text of ['Go '.repeat(30000), 'Go, '.repeat(30000), 'Excel. '.repeat(30000), 'We use Go and Swift. Excel at work. '.repeat(5000)]) {
      const t0 = performance.now();
      extractSkills(text);
      expect(performance.now() - t0).toBeLessThan(1000);
    }
  });
});

describe('extractSkills: requirement sections', () => {
  // Paraphrases of requirement sections from postings in the captured sources: the wording is new, the skill
  // mentions and the traps around them (list contexts, "make", "triage", "Java" vs "JavaScript") are the real ones.
  const cases: Array<{ title: string; text: string; must: string[]; mustNot: string[] }> = [
  {
    title: "Senior Red Team Consultant (m/f/d) (arbeitnow)",
    text: "Very good communication skills in English, spoken and written\nNice to have: hands-on background in areas such as\nBuilding and delivering malware for engagements\nIncident response\nResearching vulnerabilities and writing exploits\nReconnaissance, OSINT and social engineering\nOperational security and evading defences (AV/EDR, hardened endpoints and infrastructure, alerts raised by a SIEM, honeypots, ...)\nDetection engineering and SOC operation\nConsulting experience and clear communication with clients\nWhat we offer\nA team of experienced security specialists\nTime and budget for learning\nWork from home when it suits you.\nWork from any city in Germany\nA company trip each year\nGym membership\nPublic transport ticket\n30 days of paid holiday\nApply today and we will be in touch.\nFind more English Speaking Jobs in Germany on Arbeitnow",
    must: ["Communication","Incident Response","OSINT","Social Engineering","SIEM","Security Operations Center","Endpoint Detection and Response"],
    mustNot: ["Go","R","C"],
  },
  {
    title: "Staff Data Analyst (greenhouse)",
    text: "What you bring\nBackground as a business intelligence analyst, analytics engineer or a comparable data role, ideally at a software as a service company.\nYou have worked closely with Technical Support, Business Operations or Product Engineering teams.\nFluent SQL: joins across many tables, grouping and aggregation, common table expressions and conditional filters.\nYou have built dashboards and reports in Zendesk Explore, Tableau, Looker or similar business intelligence tools.\nTurn vague business questions into clear analytical frameworks.\nExplain findings to technical and non-technical audiences.\nPlan your own work in a remote, cross-functional team spread over time zones.",
    must: ["SQL","Tableau","Looker","Zendesk","Business Intelligence"],
    mustNot: ["Go","Sales"],
  },
  {
    title: "Staff Software Engineer, Safety Platform (greenhouse)",
    text: "Strong programming skills in languages such as Python, Rust or Typescript\nYou have designed and deployed scalable services on components like PubSub, GCP/AWS and Kubernetes\nYou have worked on large-scale distributed systems with millions of users, including deployment tooling and infrastructure automation such as Terraform\nYou have led projects that span several teams\nYou have scaled and migrated systems with little or no downtime\nYou enjoy mentoring engineers at every stage of their career\nYou build a culture of operational excellence and know your metrics, alerts and dashboards\nBonus points\nYou love Discord and gaming\nYou have tackled safety problems together with ML teams on large social platforms",
    must: ["Python","Rust","TypeScript","Kubernetes","Terraform","Google Cloud Platform","Amazon Web Services","Distributed Systems","Machine Learning"],
    mustNot: ["Go","R","Sales"],
  },
  {
    title: "Staff Accountant 1 (himalayas)",
    text: "Ensure internal control and SOX requirements are met.\nWork with people at every level of the organization.\nQualifications\nA bachelor’s degree in accounting/finance is preferred but not required.\n2-5 years in accounting, ideally focused on balance sheet reconciliations.\nSolid grasp of general ledger accounting and reconciliation.\nProficient in the utilization of Microsoft Office products (Excel, Word, Teams and Outlook).\nAble to juggle several projects at once.\nExperience preparing detailed accounting\nAble to reconcile large volumes of detailed transactions.\nAccurate, detail-oriented and well organized.\nClear communication, written and verbal, with international teams.\nStrong analytical and problem-solving",
    must: ["Accounting","Sarbanes-Oxley","General Ledger","Microsoft Office","Microsoft Excel","Microsoft Word","Microsoft Teams","Microsoft Outlook"],
    mustNot: ["Sales","Make"],
  },
  {
    title: "Data Analyst (Dashboard Developer) (himalayas)",
    text: "Strong communication and presentation skills; you can explain technical topics to non-technical people.\nYou gather requirements and present to clients, in writing and in person.\nFamiliarity with dashboard tools such as Tableau or Power BI.\nFamiliarity with cloud-based analytics environments (such as Databricks, Snowflake, or Impala).\nExperience performing analytics and data transformation using SQL, Python, and R.\nKnowledge of ETL processes and data integration tools.\nThe annual salary range for this position is $68,000.00-$113,000.00. Pay decisions depend on many factors, such as skills, experience, training, clearances, licences and business needs. What We Offer:",
    must: ["Tableau","Microsoft Power BI","Databricks","Snowflake","SQL","Python","R","ETL"],
    mustNot: ["Go","Total Rewards"],
  },
  {
    title: "Digital Marketing Specialist (jobicy)",
    text: "Requirements\nA bachelor's degree in Marketing, Communications, Business Administration or a related field.\n0–3 years of experience in digital marketing, social media management or content marketing. Agency or in-house experience both count; junior candidates are welcome.\nNative or professional Turkish, plus excellent written and spoken Business English (Fluent) - all interviews are in English!\nYou can create visuals, brochures and presentations with Canva or Adobe tools.\nYou have managed social media accounts.\nYou read marketing metrics with ease and are comfortable working with Excel or Google Sheets.\nKeen to learn, careful with detail and ready to take ownership over time.\nOrganized enough to handle several platforms and priorities at a fast pace.",
    must: ["Digital Marketing","Social Media Management","Content Marketing","Canva","Microsoft Excel","Google Sheets","Turkish"],
    mustNot: ["Go","Make"],
  },
  {
    title: "Backend Engineer - Data Platform (lever)",
    text: "Who you are\nYou have built and run backend services and APIs in production with Java, and you care about API design, versioning and backward compatibility.\nYou are comfortable with SQL and have worked on data pipelines or a cloud data warehouse such as BigQuery, Snowflake or Databricks. Experience with batch or streaming frameworks like Beam, Flink or Spark is a plus.\nYou understand data engineering concepts such as orchestration, metadata management, data quality, governance and lineage.\nYou split problems into small, shippable steps and weigh tradeoffs before recommending a path.\nYou own the quality of what you ship, AI-assisted code included, and you keep running it well after launch.",
    must: ["Java","SQL","Google BigQuery","Snowflake","Databricks","Apache Flink","Apache Spark","Data Engineering","Data Quality"],
    mustNot: ["Go","JavaScript"],
  },
  {
    title: "Human Resources Generalist (lever)",
    text: "Qualifications:\n4+ years in HR Operations, People Experience, or an HR Generalist/Coordinator role in a fast-moving workforce.\nHands-on experience with Workday (or a similar enterprise HRIS), processing lifecycle changes such as job changes, org updates, transfers and off-boarding.\nYou have handled employee intake and triage across many channels (ticketing systems, Slack, email, in person) and route sensitive cases to specialist teams (e.g., Employee Relations, Legal, Payroll, Benefits).\nWorking knowledge of California and federal employment rules (e.g., final pay, wage-and-hour and leave basics) and a record of handling confidential personnel files.",
    must: ["Workday HCM","HRIS","Slack","Employee Relations","Payroll Processing"],
    mustNot: ["Triage","Sales"],
  },
  {
    title: "Software Engineer AI Coding Tasks (remoteok)",
    text: "Requirements\n2+ years of professional software engineering\nCode merged into a public open-source repository you know well. A private codebase you own may also count (not employer or client code)\nStrong in at least one of Python, TypeScript, Go, Rust, Java or C++\nComfortable with Docker, Linux, Git and automated testing\nYou use an AI coding tool regularly\nYou have written tests, rubrics or evaluation criteria, ideally for AI models\nYou can explain a change clearly in your own words\nAt least 10 hours a week, starting now\nA secure personal or work computer (no shared machines)\nNice to have\nDeep knowledge of one area, such as databases, compilers, distributed systems, security or infrastructure\nYou have built agent tasks or RL environments\nTerms\nUS$400 - US$1,000 for each task that passes review, paid to you directly",
    must: ["Python","TypeScript","Go","Rust","Java","C++","Docker","Linux","Git"],
    mustNot: ["C","JavaScript"],
  },
  {
    title: "SimpleTiger: Web Developer: WordPress & HubSpot (U.S. Based, Remote Contractor) (weworkremotely)",
    text: "Qualifications and skills\nYou are a hands-on developer who builds from scratch, fixes existing sites and can make improvements without breaking what already works.\nRequired skills\nWordPress development: custom themes, child themes, blocks, page builders and Advanced Custom Fields (ACF). You build pages from the ground up, not only edit them.\nHubSpot CMS development: HubL templates, modules and themes, including pages, forms and email templates.\nFront-end development: solid HTML, CSS, and JavaScript, and the ability to find your way around existing code and see how a change affects the live site.\nAPIs and integrations: the HubSpot or WordPress REST APIs, plus CRMs and marketing tools such as Salesforce, Zapier, n8n, Airtable, and Slack.",
    must: ["WordPress","HubSpot","HTML","CSS","JavaScript","Salesforce","Zapier","Airtable","Slack"],
    mustNot: ["Make","Java"],
  },
  {
    title: "Senior SecOps Engineer (workingnomads)",
    text: "Strong analytical troubleshooting with structured documentation and tracking.\nBased in the CET timezone (+/- 3 hours); applications from other time zones cannot be considered.\nNice-to-have skills:\nHands-on experience with tools like Microsoft Defender XDR, Sentinel, CrowdStrike, SentinelOne, Qualys, Tenable, or Rapid7.\nScripting and automation experience (PowerShell, KQL, Bash, or Python).\nFamiliarity with frameworks such as ISO 27001, Cyber Essentials Plus, CIS Benchmarks, or PCI DSS.\nRelevant certifications (e.g., CompTIA Security+, CySA+, SC-200, AZ-500, or equivalent).\nResponsibilities:\nMonitor, triage and respond to security alerts from SIEM, EDR/XDR and MDR/MSSP partners; help with containment, recovery, root-cause analysis and post-incident reviews.",
    must: ["CrowdStrike","Qualys","PowerShell","Bash","Python","ISO 27001","PCI DSS","CompTIA Security+","SIEM"],
    mustNot: ["Triage","Go"],
  },
  {
    title: "GitLab: Backend Engineer (Python),AI Engineering: Agent Foundations (weworkremotely)",
    text: "What you bring\nYou have built and maintained production Python backend applications, including APIs, background processing and data models.\nExperience with LLM application frameworks such as LangGraph, or shipping AI-powered backend features.\nYou design or extend APIs (REST, GraphQL or gRPC) with scalability, maintainability and backward compatibility in mind.\nYou are comfortable across the stack in a mature codebase. Familiarity with Ruby on Rails and/or JavaScript and Vue is a plus.\nYou find and fix performance bottlenecks.\nClear written and verbal communication, including technical proposals and documentation, in a remote, async team.\nYou are open to learning from related technologies and fields.\nAbout the team",
    must: ["Python","Large Language Models","GraphQL","gRPC","Ruby on Rails","JavaScript","Vue.js","RESTful APIs"],
    mustNot: ["Ruby","Go"],
  },
  ];
  it('covers at least 10 sections', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });
  it.each(cases.map((c) => [c.title, c] as const))('%s', (_title, c) => {
    const found = extractSkills(c.text);
    expect(found).toEqual(expect.arrayContaining(c.must));
    for (const s of c.mustNot) expect(found).not.toContain(s);
  });
});

describe('canonicalSkill', () => {
  it('maps names and aliases case-insensitively', () => {
    expect(canonicalSkill('js')).toBe('JavaScript');
    expect(canonicalSkill('JS')).toBe('JavaScript');
    expect(canonicalSkill('k8s')).toBe('Kubernetes');
    expect(canonicalSkill('golang')).toBe('Go');
    expect(canonicalSkill('node js')).toBe('Node.js');
    expect(canonicalSkill('nodejs')).toBe('Node.js');
    expect(canonicalSkill(' python ')).toBe('Python');
    expect(canonicalSkill('excel')).toBe('Microsoft Excel');
    expect(canonicalSkill('c++')).toBe('C++');
    expect(canonicalSkill('C#')).toBe('C#');
    expect(canonicalSkill('.net')).toBe('.NET');
  });
  it('returns undefined for unknown input', () => {
    expect(canonicalSkill('underwater basket weaving')).toBeUndefined();
    expect(canonicalSkill('')).toBeUndefined();
    expect(canonicalSkill('   ')).toBeUndefined();
    expect(canonicalSkill(undefined as unknown as string)).toBeUndefined();
  });
});

describe('normalizeSkillList', () => {
  it('canonicalises, keeps unknown skills as typed, de-duplicates and keeps order', () => {
    expect(normalizeSkillList(['js', 'JavaScript', ' k8s ', 'my  custom thing', 'My Custom Thing', 'Node.js', 'nodejs', 'Kubernetes'])).toEqual([
      'JavaScript',
      'Kubernetes',
      'my custom thing',
      'Node.js',
    ]);
    expect(normalizeSkillList(['Café Ops', 'cafe ops'])).toEqual(['Café Ops']);
    expect(normalizeSkillList(['', '  ', 'SQL'])).toEqual(['SQL']);
    expect(normalizeSkillList([])).toEqual([]);
  });
});

describe('suggestSkills', () => {
  it('puts name prefixes first, then alias prefixes, then substrings', () => {
    expect(suggestSkills('pyth')[0]?.name).toBe('Python');
    const java = suggestSkills('java').map((s) => s.name);
    expect(java[0]).toBe('Java');
    expect(java).toContain('JavaScript');
    expect(suggestSkills('k8')[0]?.name).toBe('Kubernetes');
    expect(suggestSkills('postg')[0]?.name).toBe('PostgreSQL');
    const script = suggestSkills('script', 20).map((s) => s.name);
    expect(script).toEqual(expect.arrayContaining(['JavaScript', 'TypeScript']));
  });
  it('returns each canonical name once, with its category, within the limit', () => {
    const s = suggestSkills('excel', 10);
    expect(s.filter((x) => x.name === 'Microsoft Excel')).toHaveLength(1);
    expect(s[0]).toEqual({ name: expect.any(String), category: expect.any(String) });
    expect(suggestSkills('a', 5)).toHaveLength(5);
    expect(suggestSkills('')).toEqual([]);
    expect(suggestSkills('zzzzqqq')).toEqual([]);
    expect(suggestSkills('py', 0)).toEqual([]);
  });
  it('answers within a couple of milliseconds', () => {
    suggestSkills('warm');
    const qs = ['p', 'py', 'pyt', 'j', 'ja', 'jav', 'sq', 'k', 'ku', 'reac', 'nurs', 'acc'];
    const t0 = performance.now();
    for (const q of qs) suggestSkills(q);
    expect((performance.now() - t0) / qs.length).toBeLessThan(3);
  });
});

describe('skillCategory', () => {
  it('returns the dictionary category', () => {
    expect(skillCategory('Python')).toBe('programming-language');
    expect(skillCategory('Excel')).toBe(skillCategory('Microsoft Excel'));
    expect(skillCategory('PostgreSQL')).toBe('database');
    expect(skillCategory('not a skill')).toBeUndefined();
  });
});

describe('performance', () => {
  it('builds the index quickly', () => {
    expect(skillIndexBuildMs()).toBeLessThan(300);
  });
  it('extracts from thousands of descriptions per second', () => {
    const para =
      'We are looking for a Senior Backend Engineer with 5+ years of experience in Python, Go or Java, strong SQL and PostgreSQL skills, ' +
      'and hands-on experience with AWS (EC2, S3, Lambda), Docker and Kubernetes. You will design REST APIs, own CI/CD pipelines in GitHub Actions, ' +
      'and partner with product, design and data science. Nice to have: Kafka, Redis, Terraform, React and TypeScript. ';
    const doc = para.repeat(10); // ~4.8 KB
    extractSkills(doc);
    let n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 300) (extractSkills(doc), n++);
    const perSec = (n / (performance.now() - t0)) * 1000;
    // > 3,000/s on a developer machine; a loose floor here keeps the test stable on slow CI
    expect(perSec).toBeGreaterThan(500);
  });
});
