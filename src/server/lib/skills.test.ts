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

describe('extractSkills: real job descriptions', () => {
  // Excerpts of real postings from the captured sources (requirements sections).
  const cases: Array<{ title: string; text: string; must: string[]; mustNot: string[] }> = [
  {
    title: "Senior Red Team Consultant (m/f/d) (arbeitnow)",
    text: "Excellent communication skills in English (written and verbal)\nNice to have Relevant expertise from areas like\nMalware delivery and development\nIncident response\nVulnerability research and exploit development\nReconnaissance, OSINT and social engineering\nOperational security and bypassing of security measures (AV/EDR, endpoint and infrastructure hardening, SIEM generated alerts, Honeypots, ...)\nDetection engineering and SOC operation\nExperience in management consulting and communication\nWhat awaits you with us?\nDiverse team of highly motivated and competent security experts\nCulture of constant learning and improvement\nFlexible home office.\nYou can work from anywhere in Germany\nYearly company retreat\nUrban Sports Club membership\nDeutschlandticket (public transportation)\n30 days paid vacation\nApply now We are looking forward to receiving your application.\nFind more English Speaking Jobs in Germany on Arbeitnow",
    must: ["Communication","Incident Response","OSINT","Social Engineering","SIEM","Security Operations Center","Endpoint Detection and Response"],
    mustNot: ["Go","R","C"],
  },
  {
    title: "Staff Data Analyst (greenhouse)",
    text: "What you'll bring\nExperience as a business intelligence analyst, analytics engineer, or in a similar data role, ideally in a software as a service or technology company.\nExperience partnering with Technical Support, Business Operations, Product Engineering, or similar organizations.\nFluency in SQL, including complex multi-table joins, grouping and aggregation, common table expressions, and conditional filters.\nHands-on experience building dashboards and reports in Zendesk Explore, Tableau, Looker, or similar business intelligence tools.\nTranslate ambiguous business questions into structured analytical frameworks.\nPresent findings clearly to technical and non-technical stakeholders.\nPlan and prioritize work independently in a remote, cross-functional environment across time zones.",
    must: ["SQL","Tableau","Looker","Zendesk","Business Intelligence"],
    mustNot: ["Go","Sales"],
  },
  {
    title: "Staff Software Engineer, Safety Platform (greenhouse)",
    text: "Strong programming skills in languages like Python, Rust, Typescript\nExperience designing and deploying scalable services using components such as PubSub, GCP/AWS, and Kubernetes\nExperience with large-scale distributed systems serving millions of users, including deployment tools and infrastructure automations like Terraform\nExperience leading projects on cross-team and company-wide scale\nExperience scaling and migrating systems with little to no downtime\nExperience mentoring engineers at various stages in their careers\nExperience driving a culture of operational excellence, with a deep understanding of metrics, alerts, and dashboards\nBonus Points\nA strong passion for Discord and gaming\nExperience tackling safety problems in collaboration with ML teams at large-scale social platforms",
    must: ["Python","Rust","TypeScript","Kubernetes","Terraform","Google Cloud Platform","Amazon Web Services","Distributed Systems","Machine Learning"],
    mustNot: ["Go","R","Sales"],
  },
  {
    title: "Staff Accountant 1 (himalayas)",
    text: "Ensure compliance with internal control requirements and SOX requirements.\nInterfaces frequently with various levels within the organization.\nQualifications\nBachelor’s degree in accounting/finance preferred but not required.\n2-5 years of accounting experience, preferably with a focus on balance sheet account reconciliations.\nStrong understanding of general ledger accounting and reconciliation principles.\nProficient in the utilization of Microsoft Office products (Excel, Word, Teams and Outlook).\nAbility to multi-task and complete projects within specific\nExperience completing detailed accounting\nAbility to handle and reconcile large amounts of detailed transactions.\nHigh level of accuracy, attention to detail, and strong organizational skills.\nExcellent communication skills, both written and verbal with the ability to coordinate with international teams.\nStrong analytical and problem-solving",
    must: ["Accounting","Sarbanes-Oxley","General Ledger","Microsoft Office","Microsoft Excel","Microsoft Word","Microsoft Teams","Microsoft Outlook"],
    mustNot: ["Sales","Make"],
  },
  {
    title: "Data Analyst (Dashboard Developer) (himalayas)",
    text: "Strong communication and presentation skills and ability to explain technical topics to non-technical audiences.\nAbility to gather requirements and present to clients with strong written and verbal communication skills.\nFamiliarity with dashboard tools such as Tableau or Power BI.\nFamiliarity with cloud-based analytics environments (such as Databricks, Snowflake, or Impala).\nExperience performing analytics and data transformation using SQL, Python, and R.\nKnowledge of ETL processes and tools for data integration.\nThe annual salary range for this position is $68,000.00-$113,000.00. Compensation decisions depend on a wide range of factors, including but not limited to skill sets, experience and training, security clearances, licensure and certifications, and other business and organizational needs. What We Offer:",
    must: ["Tableau","Microsoft Power BI","Databricks","Snowflake","SQL","Python","R","ETL"],
    mustNot: ["Go","Total Rewards"],
  },
  {
    title: "Digital Marketing Specialist (jobicy)",
    text: "Requirements\nHave a bachelor's degree in related fields such as Marketing, Communications, Business Administration, or a related field.\n0–3 years of experience in digital marketing, social media management, or content marketing. Agency or in-house experience welcome; junior candidates are encouraged to apply.\nNative or professional proficiency in Turkish, combined with excellent written and verbal communication skills in Business English (Fluent) - All interviews will be conducted in English!\nAbility to create visuals, brochures, and presentations with Canva or Adobe tools.\nExperience managing social media accounts.\nAnalytical mindset with the ability to read and interpret marketing metrics; comfortable working with Excel or Google Sheets.\nEager to learn, detail-oriented, and ready to take ownership of tasks over time.\nHighly organized, with the ability to manage multiple platforms and priorities in a fast-paced environment.",
    must: ["Digital Marketing","Social Media Management","Content Marketing","Canva","Microsoft Excel","Google Sheets","Turkish"],
    mustNot: ["Go","Make"],
  },
  {
    title: "Backend Engineer - Data Platform (lever)",
    text: "Who You Are\nYou have solid experience building and running backend services and APIs in production with Java, and you care about API design, versioning and backward compatibility.\nYou're comfortable with SQL and have worked with data pipelines or a cloud data warehouse such as BigQuery, Snowflake or Databricks. Hands-on experience with batch or streaming frameworks like Beam, Flink or Spark is a plus.\nYou have a working understanding of data engineering concepts such as orchestration, metadata management, data quality, governance and lineage.\nYou break problems down into clear, shippable steps, reasoning through tradeoffs and risks and converging on clear recommendations.\nYou own the quality of what you ship, including code written with AI assistance, and you care about operating it well after launch.",
    must: ["Java","SQL","Google BigQuery","Snowflake","Databricks","Apache Flink","Apache Spark","Data Engineering","Data Quality"],
    mustNot: ["Go","JavaScript"],
  },
  {
    title: "Human Resources Generalist (lever)",
    text: "Qualifications:\nAt least 4 years of experience in HR Operations, People Experience, or an HR Generalist/Coordinator role supporting a fast-paced workforce.\nHands-on operational experience with Workday (or a comparable enterprise HRIS), specifically executing employee lifecycle transactions including job changes, supervisory org updates, location transfers, and off-boarding.\nDemonstrated experience managing employee intake and triage across multiple channels (ticketing systems, Slack, email, in-person), with proven judgment in routing complex or sensitive cases to specialized COEs (e.g., Employee Relations, Legal, Payroll, Benefits).\nFoundational knowledge of California and federal employment standards (e.g., California final pay rules, wage-and-hour guidelines, and statutory leave basics) combined with a verified track record of handling sensitive, confidential personnel records.",
    must: ["Workday HCM","HRIS","Slack","Employee Relations","Payroll Processing"],
    mustNot: ["Triage","Sales"],
  },
  {
    title: "Software Engineer AI Coding Tasks (remoteok)",
    text: "Requirements\n2+ years of professional software engineering\nCode merged into a public open-source repository, ideally one you know well. A private codebase you own may also qualify (not employer or client code)\nStrong in at least one of Python, TypeScript, Go, Rust, Java or C++\nSolid with Docker, Linux, Git and automated testing\nRegular use of an AI coding tool\nExperience writing tests, rubrics or evaluation criteria, ideally for AI models\nYou can explain a change clearly and concisely, in your own words\nAt least 10 hours a week, starting now\nA secure personal or work computer (no public or shared machines)\nNice to have\nDeep expertise in one area, such as databases, compilers, distributed systems, security or infrastructure\nExperience building agent tasks or RL environments\nTerms\nBetween US$400 - US$1,000 for each task that passes our quality review, paid directly to you",
    must: ["Python","TypeScript","Go","Rust","Java","C++","Docker","Linux","Git"],
    mustNot: ["C","JavaScript"],
  },
  {
    title: "SimpleTiger: Web Developer: WordPress & HubSpot (U.S. Based, Remote Contractor) (weworkremotely)",
    text: "Qualifications and skills\nYou’re a hands-on developer who can build from scratch, troubleshoot existing sites, and make improvements without disrupting what’s already working.\nRequired skills\nWordPress development: Strong experience with custom themes, child themes, blocks, page builders, and Advanced Custom Fields (ACF). You can build a page from the ground up—not just edit an existing one.\nHubSpot CMS development: Strong experience with HubL templates, modules, and themes, including building and troubleshooting pages, forms, and email templates.\nFront-end development: Solid HTML, CSS, and JavaScript skills, with the ability to navigate existing code and understand how changes affect the live site.\nAPIs and integrations: Experience working with the HubSpot or WordPress REST APIs, plus CRMs and marketing tools such as Salesforce, Zapier, n8n, Airtable, and Slack.",
    must: ["WordPress","HubSpot","HTML","CSS","JavaScript","Salesforce","Zapier","Airtable","Slack"],
    mustNot: ["Make","Java"],
  },
  {
    title: "Senior SecOps Engineer (workingnomads)",
    text: "Strong analytical troubleshooting skills with a structured approach to documentation and tracking.\nLocated in CET timezone (+/- 3 hours), we are unable to consider applications from candidates in other time zones.\nNice-to-Have Skills:\nHands-on experience with tools like Microsoft Defender XDR, Sentinel, CrowdStrike, SentinelOne, Qualys, Tenable, or Rapid7.\nExperience with scripting and automation (PowerShell, KQL, Bash, or Python).\nFamiliarity with frameworks such as ISO 27001, Cyber Essentials Plus, CIS Benchmarks, or PCI DSS.\nRelevant industry certifications (e.g., CompTIA Security+, CySA+, SC-200, AZ-500, or equivalent).\nResponsibilities:\nMonitor, triage, and respond to security alerts from SIEM, EDR/XDR, and MDR/MSSP partners; support containment, recovery, root-cause analysis, and post-incident reviews.",
    must: ["CrowdStrike","Qualys","PowerShell","Bash","Python","ISO 27001","PCI DSS","CompTIA Security+","SIEM"],
    mustNot: ["Triage","Go"],
  },
  {
    title: "GitLab: Backend Engineer (Python),AI Engineering: Agent Foundations (weworkremotely)",
    text: "What you'll bring\nExperience building and maintaining production Python backend applications, including APIs, asynchronous or background processing, and data models.\nExperience with LLM application frameworks such as LangGraph, or designing and shipping AI-powered backend features or harnesses.\nSkill in designing or extending APIs (REST, GraphQL or gRPC) with attention to scalability, maintainability and backward compatibility.\nComfort working across the stack in a mature codebase. Familiarity with Ruby on Rails and/or JavaScript and Vue is a plus.\nExperience finding and fixing performance bottlenecks in applications.\nClear written and verbal communication, including technical proposals and documentation, in a remote, async, cross-functional team.\nOpenness to learning and to applying skills from related technologies or fields.\nAbout the team",
    must: ["Python","Large Language Models","GraphQL","gRPC","Ruby on Rails","JavaScript","Vue.js","RESTful APIs"],
    mustNot: ["Ruby","Go"],
  },
  ];
  it('has at least 10 real descriptions', () => {
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
