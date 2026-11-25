import { describe, expect, it } from 'vitest';
import {
  analyzeTitle,
  detectEmploymentType,
  detectSeniority,
  expandTitle,
  findRole,
  getRole,
  roleIndexBuildMs,
  rolesForSkills,
  suggestTitles,
} from './titles';

type Row = [raw: string, core: string, seniority: string, roleId: string | null];

const check = ([raw, core, seniority, roleId]: Row): void => {
  const a = analyzeTitle(raw);
  expect({ raw, core: a.core, seniority: a.seniority, role: a.role?.id ?? null }).toEqual({ raw, core, seniority, role: roleId });
};

describe('analyzeTitle: titles from the brief', () => {
  const rows: Row[] = [
    ['Senior Software Engineer, Backend (Remote - US)', 'software engineer backend', 'senior', 'backend-engineer'],
    ['Sr. Software Engineer II (Remote) - Payments', 'software engineer payments', 'senior', 'software-engineer'],
    ['Software Engineer II', 'software engineer', 'mid', 'software-engineer'],
    ['Staff Software Engineer (L6)', 'software engineer', 'lead', 'software-engineer'],
    ['Principal Product Manager, Growth', 'product manager growth', 'lead', 'product-manager'],
    ['Product Manager', 'product manager', 'unknown', 'product-manager'],
    ['Engineering Manager', 'engineering manager', 'manager', 'engineering-manager'],
    ['Director of Engineering', 'director of engineering', 'director', 'director-of-engineering'],
    ['VP, Sales', 'vp sales', 'executive', 'sales-director'],
    ['Head of Design', 'head of design', 'director', 'art-director'],
    // a senior IC/lead role in the taxonomy, not an executive
    ['Chief of Staff', 'chief of staff', 'lead', 'chief-of-staff'],
    ['Associate Product Manager', 'product manager', 'entry', 'product-manager'],
    ['Associate Director', 'associate director', 'director', null],
    // the explicit level word wins; "Associate" as the head noun is not a level
    ['Senior Associate, Audit', 'associate audit', 'senior', 'auditor'],
    ['Junior Data Analyst', 'data analyst', 'entry', 'data-analyst'],
    ['Data Analyst Intern (Summer 2027)', 'data analyst', 'intern', 'data-analyst'],
    ['Werkstudent (m/w/d) Marketing', 'marketing', 'intern', null],
    ['Registered Nurse (RN) - ICU - Nights', 'registered nurse icu', 'unknown', 'icu-nurse'],
    ['Travel Nurse RN - Med Surg - $2,450 per week', 'travel nurse rn med surg', 'unknown', 'travel-nurse'],
    ['CDL-A Truck Driver - Home Daily', 'cdl a truck driver', 'unknown', 'truck-driver'],
    ['Account Executive, Mid-Market (French speaking)', 'account executive mid market', 'unknown', 'account-executive'],
    ['Customer Success Manager', 'customer success manager', 'unknown', 'customer-success-manager'],
    ['Assistant Store Manager', 'assistant store manager', 'manager', 'store-manager'],
    // corporate General Manager (executive-leadership family) vs hospitality/retail general managers
    ['General Manager', 'general manager', 'executive', 'general-manager'],
    ['Restaurant General Manager', 'restaurant general manager', 'manager', 'restaurant-manager'],
    ['Assistant General Manager', 'assistant general manager', 'manager', 'general-manager'],
    ['Lead Line Cook', 'line cook', 'lead', 'cook'],
    ['Tech Lead', 'tech lead', 'lead', 'software-engineer'],
    ['Team Lead, Customer Support', 'team lead customer support', 'manager', null],
    ['Sr Staff ML Engineer', 'ml engineer', 'lead', 'machine-learning-engineer'],
    ['Member of Technical Staff', 'member of technical staff', 'unknown', 'software-engineer'],
    ['Founding Engineer', 'founding engineer', 'unknown', 'software-engineer'],
    ['Full Stack Developer (React/Node) - 100% Remote', 'full stack developer', 'unknown', 'full-stack-engineer'],
    ['Développeur Full Stack H/F', 'developpeur full stack', 'unknown', 'full-stack-engineer'],
    ['Senior Software Engineer (all genders)', 'software engineer', 'senior', 'software-engineer'],
    ['Software Engineer, New Grad 2027', 'software engineer', 'entry', 'software-engineer'],
    ['Software Engineer - Early Career', 'software engineer', 'entry', 'software-engineer'],
    ['Machine Learning Engineer, LLM Inference [Contract]', 'machine learning engineer llm inference', 'unknown', 'machine-learning-engineer'],
    ['Part-Time Bookkeeper', 'bookkeeper', 'unknown', 'bookkeeper'],
    ['REQ-12345 Senior Accountant', 'accountant', 'senior', 'accountant'],
    ['Senior Accountant #4421', 'accountant', 'senior', 'accountant'],
    ['Electrician - Journeyman', 'electrician', 'mid', 'electrician'],
    ['Paralegal II', 'paralegal', 'mid', 'paralegal'],
    ['Attorney (5+ years)', 'attorney', 'senior', 'attorney'],
    ['Teacher - 5th Grade', 'teacher 5th grade', 'unknown', null],
    ['Adjunct Professor of Biology', 'adjunct professor of biology', 'unknown', 'professor'],
    ['Staff Accountant', 'staff accountant', 'unknown', 'staff-accountant'],
    ['Senior Staff Accountant', 'staff accountant', 'senior', 'staff-accountant'],
    ['Executive Assistant to the CEO', 'executive assistant to the ceo', 'unknown', 'executive-assistant'],
    ['Managing Director', 'managing director', 'executive', null],
    ['Executive Director', 'executive director', 'executive', 'executive-director'],
    ['Senior Director, Product Marketing', 'director product marketing', 'director', 'marketing-director'],
    ['AVP, Risk', 'avp risk', 'director', null],
    ['Partner, Tax', 'partner tax', 'executive', null],
    ['HR Business Partner', 'hr business partner', 'unknown', 'hr-business-partner'],
    ['Intern', 'intern', 'intern', null],
    ['Software Architect', 'software architect', 'lead', 'solutions-architect'],
    // a building architect is a profession, not a level
    ['Landscape Architect', 'landscape architect', 'unknown', 'landscape-architect'],
    ['Engineering Manager II', 'engineering manager', 'manager', 'engineering-manager'],
    ['Principal', 'principal', 'unknown', 'principal'],
    ['Assistant Principal', 'assistant principal', 'unknown', 'principal'],
    ['Senior Living Sales Director', 'senior living sales director', 'director', 'sales-director'],
    ['Senior Product Designer (m/f/d) – Berlin', 'product designer', 'senior', 'product-designer'],
    ['Podcast Host', 'podcast host', 'unknown', null],
    ['Data Science Intern', 'data science', 'intern', 'data-scientist'],
    ['Software Engineering Intern', 'software engineering', 'intern', 'software-engineer'],
    ['Graduate Software Engineer', 'software engineer', 'entry', 'software-engineer'],
    ['Software Engineer III', 'software engineer', 'senior', 'software-engineer'],
    ['Software Engineer 2', 'software engineer', 'mid', 'software-engineer'],
    ['Software Engineer, Level 2', 'software engineer', 'mid', 'software-engineer'],
    ['Distinguished Engineer', 'engineer', 'lead', null],
    ['Chief Technology Officer', 'chief technology officer', 'executive', 'chief-technology-officer'],
    ['CTO', 'cto', 'executive', 'chief-technology-officer'],
    ['Co-Founder & CTO', 'co founder cto', 'executive', 'chief-technology-officer'],
    ['Shift Supervisor', 'shift supervisor', 'manager', null],
    ['Mid-Level Frontend Developer', 'frontend developer', 'mid', 'frontend-engineer'],
    ['Entry Level Customer Service Representative', 'customer service representative', 'entry', 'customer-service-representative'],
    ['Apprentice Electrician', 'electrician', 'intern', 'electrician'],
    ['Customer Service Representative - Independent Contractor', 'customer service representative', 'unknown', 'customer-service-representative'],
    ['Quality Assurance Rater - Spanish speakers in Spain', 'quality assurance rater', 'unknown', null],
  ];
  it.each(rows)('%s', (...row) => check(row as Row));
});

describe('analyzeTitle: real posting titles from the captured sources', () => {
  // Expected values reviewed by hand. Titles come from Ashby, Greenhouse, Lever, Arbeitnow, Himalayas,
  // Jobicy, RemoteOK, Remotive, Working Nomads and HN "Who is hiring" captures.
  const rows: Row[] = [
    ["Senior Revenue Operations RevOps Manager (m/f/d) - Berlin", "revenue operations revops manager", 'senior', 'revenue-operations-manager'],
    ["Senior Red Team Consultant (m/f/d)", "red team consultant", 'senior', null],
    ["Senior Data & AI Consultant (m/w/d) – Automotive", "data ai consultant automotive", 'senior', null],
    ["Support Engineer Telefonie", "support engineer telefonie", 'unknown', 'technical-support-engineer'],
    ["Werkstudent Webentwicklung - Digitalhub (m/w/d)", "webentwicklung digitalhub", 'intern', null],
    ["Product Engineer (m/f/d)", "product engineer", 'unknown', null],
    ["Praktikum im Customer Success Management (m/w/d)", "customer success management", 'intern', null],
    ["Forward Deployed Engineer (m/w/d)- Certil", "forward deployed engineer certil", 'unknown', null],
    ["Verantwortliche Elektrofachkraft (VEFK) (m/w/d) – DGUV-Prüfmanagement", "verantwortliche elektrofachkraft dguv prufmanagement", 'unknown', null],
    ["Commercial Account Executive UKI", "commercial account executive", 'unknown', 'account-executive'],
    ["Senior Managing Consultant", "managing consultant", 'senior', null],
    ["Sales Planning & Strategy", "sales planning strategy", 'unknown', null],
    ["Freelancer - Group Fitness Instructor (m/w/d)", "group fitness instructor", 'unknown', 'fitness-instructor'],
    ["Senior Platform Engineer", "platform engineer", 'senior', 'platform-engineer'],
    ["Stagiair Finance", "finance", 'intern', null],
    ["Account Executive, Growth", "account executive growth", 'unknown', 'account-executive'],
    ["Creative Producer", "creative producer", 'unknown', null],
    ["Business Development Representative", "business development representative", 'unknown', 'business-development-representative'],
    ["Enterprise Solutions Consultant (Atlanta, GA)", "enterprise solutions consultant", 'unknown', 'sales-engineer'],
    ["Recruiting Coordinator - Contract", "recruiting coordinator", 'unknown', 'recruiting-coordinator'],
    ["Android Engineer, Applied Foundations", "android engineer applied foundations", 'unknown', 'android-engineer'],
    ["Security Engineer, Infrastructure Security", "security engineer infrastructure security", 'unknown', 'security-engineer'],
    ["Account Executive | Commercial", "account executive commercial", 'unknown', 'account-executive'],
    ["Risk Strategy Intern", "risk strategy", 'intern', null],
    ["Compliance Strategist", "compliance strategist", 'unknown', null],
    ["Applied AI Engineer", "applied ai engineer", 'unknown', 'ai-engineer'],
    ["Senior Scaled Customer Activation Manager | Canada", "scaled customer activation manager", 'senior', null],
    ["General Manager, India", "general manager", 'executive', 'general-manager'],
    ["Abuse Investigator", "abuse investigator", 'unknown', null],
    ["Business Development Representative, Japan", "business development representative", 'unknown', 'business-development-representative'],
    ["Engineering Manager, Dedicated Integrations", "engineering manager dedicated integrations", 'manager', 'engineering-manager'],
    ["Junior Talent Operations Specialist", "talent operations specialist", 'entry', null],
    ["Manager, Sales Recruiting (AMER)", "manager sales recruiting", 'manager', 'talent-acquisition-manager'],
    ["Renewals Manager - Italy/ Spain", "renewals manager", 'unknown', null],
    ["Staff Data Analyst", "data analyst", 'lead', 'data-analyst'],
    ["Account Executive, Media & Entertainment", "account executive media entertainment", 'unknown', 'account-executive'],
    ["Senior Manager, Global Indirect Tax", "manager global indirect tax", 'manager', 'tax-accountant'],
    ["Senior Platform Security Engineer", "platform security engineer", 'senior', 'security-engineer'],
    ["Senior Staff Brand Designer", "brand designer", 'lead', 'graphic-designer'],
    ["Staff Software Engineer, Safety Platform", "software engineer safety platform", 'lead', 'software-engineer'],
    ["Threat Investigator Team Lead", "threat investigator team lead", 'manager', null],
    ["AI Research Engineer, New PhD Graduate", "ai research engineer", 'entry', null],
    ["Head of Merchandising, Japan", "head of merchandising", 'director', null],
    ["Proctor Quality and Learning Manager, Scaling Operations", "proctor quality and learning manager scaling operations", 'manager', null],
    ["Product Designer, Thrive Intern", "product designer thrive", 'intern', 'product-designer'],
    ["Senior Business Development Manager, China", "business development manager", 'senior', 'business-development-manager'],
    ["Staff AI Research Engineer, Speech Recognition", "ai research engineer speech recognition", 'lead', null],
    ["Account Executive, Commercial Hunter Japan", "account executive commercial hunter", 'unknown', 'account-executive'],
    ["Account Executive, Enterprise Platforms (Grower)", "account executive enterprise platforms", 'unknown', 'account-executive'],
    ["Account Executive Product - Fraud & Risk", "account executive product fraud risk", 'unknown', 'account-executive'],
    ["Account Executive, Product Sales - Tax", "account executive product sales tax", 'unknown', 'account-executive'],
    ["Data Scientist", "data scientist", 'unknown', 'data-scientist'],
    ["Operations Associate, Tax Jar", "operations associate tax jar", 'unknown', 'operations-coordinator'],
    ["Staff Security Engineer, Abuse Control", "security engineer abuse control", 'lead', 'security-engineer'],
    ["Senior Strategic Business Developer, K-12 Financial Solutions", "strategic business developer k 12 financial solutions", 'senior', null],
    ["National General Adjuster - Inside", "national general adjuster inside", 'unknown', null],
    ["SAP HCM Solution Architect", "sap hcm solution architect", 'lead', 'solutions-architect'],
    ["Медицинский представитель-1", "медицинскии представитель", 'entry', null],
    ["Accounts Payable Officer — Property Management", "accounts payable officer property management", 'unknown', null],
    ["Analista de Qualidade (QA) - Sênior", "analista de qualidade", 'senior', null],
    ["Werkstudent Content Creation für unsere Regio Blogs (m/w/d)", "content creation fur unsere regio blogs", 'intern', null],
    ["Traveller Support Agent - Trilingual French, English and Spanish Speaker Brazil", "traveller support agent", 'unknown', null],
    ["Marketing Project Manager", "marketing project manager", 'unknown', 'project-manager'],
    ["Client Implementation Engineer", "client implementation engineer", 'unknown', 'implementation-specialist'],
    ["Workers' Compensation Adjustor", "workers compensation adjustor", 'unknown', null],
    ["Vice President, Total Rewards", "vice president total rewards", 'executive', null],
    ["Coder, Auditing", "coder auditing", 'unknown', null],
    ["Employee Relations Advisor", "employee relations advisor", 'unknown', 'employee-relations-specialist'],
    ["Staff Accountant 1", "staff accountant", 'entry', 'staff-accountant'],
    ["Team Lead Product Design (Service)", "team lead product design", 'manager', 'product-designer'],
    ["Online Ad Rater - English speakers in the United States", "online ad rater", 'unknown', null],
    ["Analytics & Rptg Consultant", "analytics rptg consultant", 'unknown', null],
    ["Temp-Project Manager, Product Operations", "project manager product operations", 'unknown', 'project-manager'],
    ["Senior Back-end Developer", "back end developer", 'senior', 'backend-engineer'],
    ["Senior Software Engineer", "software engineer", 'senior', 'software-engineer'],
    ["Data Analyst (Dashboard Developer)", "data analyst", 'unknown', 'data-analyst'],
    ["Cientista de Dados Especialista", "cientista de dados especialista", 'unknown', null],
    ["AI/ML Engineer-1", "ai ml engineer", 'entry', 'machine-learning-engineer'],
    ["Portfolio Customer Success Manager", "portfolio customer success manager", 'unknown', 'customer-success-manager'],
    ["Cloud Platform Engineer", "cloud platform engineer", 'unknown', 'platform-engineer'],
    ["Senior Strategic Implementation Specialist - Americas", "strategic implementation specialist", 'senior', 'implementation-specialist'],
    ["Junior Content Editor", "content editor", 'entry', 'editor'],
    ["English to Belarusian Review Lead for UI, Marketing & Product Content", "english to belarusian review lead for ui marketing product content", 'lead', null],
    ["Senior Manager, Solution Engineering - DocV", "manager solution engineering docv", 'manager', 'engineering-manager'],
    ["Fullstack Engineer", "fullstack engineer", 'unknown', 'full-stack-engineer'],
    ["Engineering Manager- Ceph & Distributed Storage", "engineering manager ceph distributed storage", 'manager', 'engineering-manager'],
    ["AI Software Engineer", "ai software engineer", 'unknown', 'ai-engineer'],
    ["Software Engineer (Go)", "software engineer", 'unknown', 'software-engineer'],
    ["Part-Time Psychotherapist (Saturday & Sunday)", "psychotherapist", 'unknown', 'therapist'],
    ["Digital Marketing Specialist", "digital marketing specialist", 'unknown', 'digital-marketing-specialist'],
    ["Seasonal Customer Love Associate - (Remote - TX based)", "customer love associate", 'unknown', null],
    ["Performance Marketer (Remote - Worldwide)", "performance marketer", 'unknown', null],
    ["Data Engineering Intern", "data engineering", 'intern', 'data-engineer'],
    ["Software Tester (Freelance) | Test AT&T U-verse & Cox", "software tester test at t u verse cox", 'unknown', 'qa-engineer'],
    ["Senior Consultant, Sales Effectiveness", "consultant sales effectiveness", 'senior', null],
    ["Business Development Representative – DACH (f/m/d)", "business development representative", 'unknown', 'business-development-representative'],
    ["Accounting Assistant", "accounting assistant", 'unknown', null],
    ["Scout Junior Quality Coordinator - Portuguese (Brazil)", "scout quality coordinator portuguese", 'entry', null],
    ["Jr. HR Associate (Talent Acquisition)", "hr associate", 'entry', 'hr-coordinator'],
    ["Senior Product Manager, Ad Monetization", "product manager ad monetization", 'senior', 'product-manager'],
    ["International Audio/Video Remote Hakha Chin Interpreter", "international audio video hakha chin interpreter", 'unknown', 'translator'],
    ["Administrative Business Partner", "administrative business partner", 'unknown', null],
    ["Procurement Operations Analyst", "procurement operations analyst", 'unknown', null],
    ["Intellectual Property Counsel", "intellectual property counsel", 'unknown', null],
    ["Contract Operations", "operations", 'unknown', null],
    ["Finance Operator Intern", "finance operator", 'intern', null],
    ["Product Designer, Internship", "product designer", 'intern', 'product-designer'],
    ["Talent Coordinator", "talent coordinator", 'unknown', null],
    ["Workplace Operations Analyst", "workplace operations analyst", 'unknown', null],
    ["Accounting Analyst, Content Accounting", "accounting analyst content accounting", 'unknown', 'staff-accountant'],
    ["Audiobook Licensing & Partnerships Manager - Japan", "audiobook licensing partnerships manager", 'unknown', 'partnerships-manager'],
    ["Backend Engineer - Data Platform", "backend engineer data platform", 'unknown', 'backend-engineer'],
    ["Backend Engineer - Music", "backend engineer music", 'unknown', 'backend-engineer'],
    ["Client Partner ANZ", "client partner", 'unknown', null],
    ["Marketing Manager Taiwan", "marketing manager", 'unknown', 'marketing-manager'],
    ["Account Manager - LearnGxP", "account manager learngxp", 'unknown', 'account-manager'],
    ["Account Partner - Commercial", "account partner commercial", 'unknown', null],
    ["Account Partner - Quality Cloud", "account partner quality cloud", 'unknown', null],
    ["Account Partner - Veeva Basics", "account partner veeva basics", 'unknown', null],
    ["Associate Consultant - Entry-Level Clinical Data Technology Consulting", "consultant clinical data technology consulting", 'entry', null],
    ["Administrative Business Partner, Product", "administrative business partner product", 'unknown', null],
    ["Contract Student Worker  – Firmware Engineer (FW Core System Services)", "firmware engineer", 'intern', 'embedded-software-engineer'],
    ["Data Science Intern [Summer 2027]", "data science", 'intern', 'data-scientist'],
    ["Embedded Software Engineer", "embedded software engineer", 'unknown', 'embedded-software-engineer'],
    ["Human Resources Generalist", "human resources generalist", 'unknown', 'hr-generalist'],
    ["Logistics MRO Associate", "logistics mro associate", 'unknown', null],
    ["Manager, Technical Recruiting", "manager technical recruiting", 'manager', 'talent-acquisition-manager'],
    ["Recruiting Coordinator", "recruiting coordinator", 'unknown', 'recruiting-coordinator'],
    ["Senior Software Developer, Agentic AI - Canada", "software developer agentic ai", 'senior', 'software-engineer'],
    ["Manager, Technical Accounting and Equity Reporting", "manager technical accounting and equity reporting", 'manager', null],
    ["Revenue Operations Leader, Strategy & Planning", "revenue operations leader strategy planning", 'lead', null],
    ["Manager, Network Contracting (Southeast Region)", "manager network contracting", 'manager', null],
    ["Senior Applied AI Engineer", "applied ai engineer", 'senior', 'ai-engineer'],
    ["Account Director", "account director", 'director', null],
    ["Senior Product Engineer", "product engineer", 'senior', null],
    ["IT Manager", "it manager", 'manager', 'it-manager'],
    ["Graduate Transport Planner", "transport planner", 'entry', null],
    ["Technical Account Manager", "technical account manager", 'unknown', 'sales-engineer'],
    ["Renewables Project Scheduler", "renewables project scheduler", 'unknown', null],
    ["Customer Support Representative", "customer support representative", 'unknown', 'customer-support-specialist'],
    ["Software Engineer AI Coding Tasks", "software engineer ai coding tasks", 'unknown', 'software-engineer'],
    ["Senior Vue Developer", "vue developer", 'senior', 'frontend-engineer'],
    ["Cloud Engineer Automation", "cloud engineer automation", 'unknown', 'cloud-engineer'],
    ["DESARROLLADOR FULL STACK", "desarrollador full stack", 'unknown', 'full-stack-engineer'],
    ["Data Analyst", "data analyst", 'unknown', 'data-analyst'],
    ["Senior Data Analyst", "data analyst", 'senior', 'data-analyst'],
    ["Content Creator - YouTube", "content creator youtube", 'unknown', null],
    ["Remote Office Assistant", "office assistant", 'unknown', 'administrative-assistant'],
    ["Customer Service Representative", "customer service representative", 'unknown', 'customer-service-representative'],
    ["Freelance Writer", "writer", 'unknown', null],
    ["Senior Data Engineer", "data engineer", 'senior', 'data-engineer'],
    ["Freelance Copywriter", "copywriter", 'unknown', 'copywriter'],
    ["Case Manager (Philippines)", "case manager", 'unknown', 'case-manager'],
    ["Quality Assurance Rater - Spanish speakers in Spain", "quality assurance rater", 'unknown', null],
    ["Video Creator (100% remote)", "video creator", 'unknown', null],
    ["Remote Customer Service Representative - Independent Contractor", "customer service representative", 'unknown', 'customer-service-representative'],
    ["Senior SecOps Engineer", "secops engineer", 'senior', 'security-engineer'],
    ["New Business Manager", "new business manager", 'unknown', 'business-development-manager'],
    ["Customer Success Manager", "customer success manager", 'unknown', 'customer-success-manager'],
    ["Content Reviewer - United States", "content reviewer", 'unknown', null],
    ["Quality Assurance Rater - German speakers in Germany", "quality assurance rater", 'unknown', null],
    ["Quality Assurance Rater - French speakers in France", "quality assurance rater", 'unknown', null],
    ["Part-time B2B Sales Lead", "b2b sales lead", 'lead', null],
    ["Software Engineer", "software engineer", 'unknown', 'software-engineer'],
    ["Penetration Tester", "penetration tester", 'unknown', 'penetration-tester'],
    ["Founding Builder-in-Residence", "founding builder in residence", 'unknown', null],
    ["Forward Deployed Engineer, Founding Product Engineer", "forward deployed engineer founding product engineer", 'unknown', null],
    ["Lead Software Engineer", "software engineer", 'lead', 'software-engineer'],
  ];
  it('has a diverse sample of at least 80 titles', () => {
    expect(rows.length).toBeGreaterThanOrEqual(80);
  });
  it.each(rows)('%s', (...row) => check(row as Row));
});

describe('analyzeTitle: the same posting seen through different sources shares a core', () => {
  const groups: string[][] = [
    [
      'Senior Software Engineer, Backend (Remote - US)',
      'Senior Software Engineer - Backend',
      'SENIOR SOFTWARE ENGINEER – BACKEND',
      'Senior Software Engineer | Backend | Remote',
      'Sr. Software Engineer, Backend - London, UK',
      'Senior Software Engineer — Backend [Remote]',
      'senior software engineer, backend (m/f/d)',
    ],
    [
      'Product Designer',
      'Product Designer - Berlin',
      'Product Designer (Remote)',
      'Product Designer [Remote]',
      'Product Designer, NYC',
      'Product Designer | Berlin, Germany',
      'Product Designer - EMEA',
      'Product Designer - US Remote',
      'Product Designer (m/f/d)',
      'Product Designer – Remote (US only)',
      'Product Designer - Remote, United States',
      'Product Designer - San Francisco, CA',
      'Product Designer - Austin, TX or Remote',
      'Product Designer - Georgia',
      'Product Designer, São Paulo',
      'Product Designer (Hybrid) - Toronto, ON',
      'Product Designer - 100% Remote',
      'Product Designer #12345',
    ],
    ['Software Engineer - Payments', 'Software Engineer, Payments', 'Software Engineer | Payments | London', 'Software Engineer — Payments (Remote)'],
    ['Registered Nurse - ICU - Nights', 'Registered Nurse – ICU (Nights)', 'REGISTERED NURSE - ICU', 'Registered Nurse - ICU - $2,100/week'],
    ['Account Executive, Mid-Market', 'Account Executive - Mid Market', 'Account Executive, Mid-Market (French speaking)'],
    ['Data Engineer', 'Data Engineer (Contract)', 'Data Engineer [Full-Time]', 'Data Engineer - Contract', 'Full-Time Data Engineer'],
    ['Développeur Full Stack H/F', 'Developpeur Full Stack (H/F)', 'Développeur full-stack'],
    ['Customer Success Manager - DACH', 'Customer Success Manager (DACH)', 'Customer Success Manager, DACH Region'],
  ];
  it.each(groups.map((g) => [g[0]!, g]))('%s', (_first, group) => {
    const cores = new Set((group as string[]).map((t) => analyzeTitle(t).core));
    expect([...cores]).toHaveLength(1);
  });
});

describe('analyzeTitle: different jobs keep different cores', () => {
  const pairs: Array<[string, string]> = [
    ['Software Engineer - Payments', 'Software Engineer - Fraud'],
    ['Software Engineer - Growth', 'Software Engineer - London'],
    ['Account Executive, Growth', 'Account Executive, Enterprise'],
    ['Backend Engineer - Data Platform', 'Backend Engineer - Music'],
    ['Product Manager, Payments', 'Product Manager, Search'],
    // city names that are also ordinary title words are not places
    ['Software Engineer - Mobile', 'Software Engineer'],
    ['Software Engineer, Commerce', 'Software Engineer'],
    ['Software Engineer, Enterprise', 'Software Engineer'],
    ['Marketing Manager - Paris', 'Marketing Manager - Partnerships'],
    ['Security Engineer, Detection & Response', 'Security Engineer, Identity'],
    ['Teacher - 5th Grade', 'Teacher - 3rd Grade'],
    ['Senior Engineer, Platform', 'Senior Engineer, Infrastructure'],
  ];
  it.each(pairs)('%s / %s', (a, b) => {
    expect(analyzeTitle(a).core).not.toBe(analyzeTitle(b).core);
  });
  it('strips a trailing location but keeps a trailing team', () => {
    expect(analyzeTitle('Software Engineer - London').core).toBe('software engineer');
    expect(analyzeTitle('Software Engineer, NYC').core).toBe('software engineer');
    expect(analyzeTitle('Software Engineer | Berlin, Germany').core).toBe('software engineer');
    expect(analyzeTitle('Software Engineer - EMEA').core).toBe('software engineer');
    expect(analyzeTitle('Software Engineer - US Remote').core).toBe('software engineer');
    expect(analyzeTitle('Software Engineer - Payments').core).toBe('software engineer payments');
    expect(analyzeTitle('Software Engineer, Growth').core).toBe('software engineer growth');
  });
});

describe('analyzeTitle: robustness', () => {
  it('handles empty and odd input', () => {
    expect(analyzeTitle('')).toEqual({ raw: '', core: '', seniority: 'unknown' });
    expect(analyzeTitle('   ').core).toBe('');
    expect(analyzeTitle('---').core).toBe('');
    expect(analyzeTitle('()[]').core).toBe('');
    expect(analyzeTitle(undefined as unknown as string).core).toBe('');
    expect(analyzeTitle('🚀 Software Engineer 🚀').role?.id).toBe('software-engineer');
  });
  it('keeps raw and never throws on hostile input', () => {
    const weird = ['(((Senior', 'Senior)))', '[Contract', 'Engineer - - - - Remote', 'L99', 'II', 'Senior Senior Senior', '$$$', '#1', 'a'.repeat(5000), '- London', 'Remote', '(Remote)', 'Manager,', ', , ,', 'Sr.', 'Chief', 'VP'];
    for (const t of weird) {
      const a = analyzeTitle(t);
      expect(a.raw).toBe(t);
      expect(typeof a.core).toBe('string');
    }
    expect(analyzeTitle('(((Senior').seniority).toBe('senior');
    expect(analyzeTitle('Remote').core).toBe('remote');
  });
  it('drops requisition ids, years and pay decorations', () => {
    expect(analyzeTitle('Job ID 778812 - Warehouse Associate').core).toBe('warehouse associate');
    expect(analyzeTitle('Warehouse Associate - $18/hr').core).toBe('warehouse associate');
    expect(analyzeTitle('Warehouse Associate (Up to $22 per hour)').core).toBe('warehouse associate');
    expect(analyzeTitle('Summer 2027 Software Engineering Intern').core).toBe('software engineering');
  });
});

describe('analyzeTitle: regressions found by attacking the parser', () => {
  const rows: Row[] = [
    ['Senior Staff Brand Designer', 'brand designer', 'lead', 'graphic-designer'],
    ['Software Engineer (Frontend)', 'software engineer', 'unknown', 'frontend-engineer'],
    ['Software Engineer, Frontend', 'software engineer frontend', 'unknown', 'frontend-engineer'],
    ['Sr. Mgr, Product Marketing', 'mgr product marketing', 'manager', 'product-marketing-manager'],
    ['Dir. of Sales', 'dir of sales', 'director', 'sales-director'],
    ['Vice President, Engineering', 'vice president engineering', 'executive', 'director-of-engineering'],
    ['Manager of Engineering', 'manager of engineering', 'manager', 'engineering-manager'],
    ['Senior or Staff Engineer', 'engineer', 'lead', null],
    ['Junior/Mid Developer', 'developer', 'mid', null],
    ['Nurse - Orange County', 'nurse', 'unknown', 'registered-nurse'],
    ['C++ Developer', 'c++ developer', 'unknown', 'software-engineer'],
    ['React Native Developer', 'react native developer', 'unknown', 'mobile-engineer'],
    ['Softwareentwickler (m/w/d)', 'softwareentwickler', 'unknown', 'software-engineer'],
    ['Ingénieur logiciel', 'ingenieur logiciel', 'unknown', 'software-engineer'],
    ['Desarrollador Backend Senior', 'desarrollador backend', 'senior', 'backend-engineer'],
    ['Of Counsel', 'of counsel', 'unknown', null],
    ['Now Hiring: Line Cook', 'line cook', 'unknown', 'cook'],
    ['Looking for a Line Cook', 'line cook', 'unknown', 'cook'],
    ['Praktikum im Marketing', 'marketing', 'intern', null],
    ['Level 2 Support Engineer', 'level 2 support engineer', 'unknown', 'technical-support-engineer'],
    ['IT Support Specialist - Level 2', 'it support specialist', 'mid', 'it-support-specialist'],
    ['Junior Talent Operations Specialist', 'talent operations specialist', 'entry', null],
    ['AI Research Engineer, New PhD Graduate', 'ai research engineer', 'entry', null],
    ['Online Ad Rater - English speakers in the United States', 'online ad rater', 'unknown', null],
    ['Senior Scaled Customer Activation Manager | Canada', 'scaled customer activation manager', 'senior', null],
    ['Head Chef', 'head chef', 'lead', 'chef'],
    ['Art Director', 'art director', 'unknown', 'art-director'],
    ['Funeral Director', 'funeral director', 'unknown', null],
  ];
  it.each(rows)('%s', (...row) => check(row as Row));
  it('stays fast on absurdly long input', () => {
    for (const t of ['Manager '.repeat(3000), 'Senior '.repeat(3000), 'Engineer - '.repeat(2000), '('.repeat(5000) + 'Engineer', 'm/w/d '.repeat(2000)]) {
      const t0 = performance.now();
      const a = analyzeTitle(t);
      expect(performance.now() - t0).toBeLessThan(50);
      expect(a.raw).toBe(t);
    }
  });
});

describe('detectSeniority', () => {
  it('uses the title first', () => {
    expect(detectSeniority('Senior Data Engineer', 'Entry level', '0-2 years of experience')).toBe('senior');
    expect(detectSeniority('Product Manager')).toBe('unknown');
    expect(detectSeniority('Engineering Manager')).toBe('manager');
    expect(detectSeniority('Customer Success Manager')).toBe('unknown');
    expect(detectSeniority('Project Manager')).toBe('unknown');
    expect(detectSeniority('Account Manager')).toBe('unknown');
    expect(detectSeniority('Program Manager')).toBe('unknown');
    expect(detectSeniority('Community Manager')).toBe('unknown');
    expect(detectSeniority('Marketing Manager')).toBe('unknown');
    expect(detectSeniority('Senior Manager, Finance')).toBe('manager');
    expect(detectSeniority('Office Manager')).toBe('manager');
    expect(detectSeniority('Head of Engineering')).toBe('director');
    expect(detectSeniority('SVP Engineering')).toBe('executive');
    expect(detectSeniority('Vice President of Sales')).toBe('executive');
    expect(detectSeniority('Assistant Vice President, Operations')).toBe('director');
    expect(detectSeniority('Founder in Residence')).toBe('executive');
  });
  it('falls back to the source value', () => {
    expect(detectSeniority('Software Engineer', 'Mid-Senior level')).toBe('senior');
    expect(detectSeniority('Software Engineer', 'Entry level')).toBe('entry');
    expect(detectSeniority('Software Engineer', 'Associate')).toBe('entry');
    expect(detectSeniority('Software Engineer', 'Internship')).toBe('intern');
    expect(detectSeniority('Software Engineer', 'Director')).toBe('director');
    expect(detectSeniority('Software Engineer', 'Executive')).toBe('executive');
    expect(detectSeniority('Software Engineer', 'Not Applicable')).toBe('unknown');
  });
  it('falls back to the description, conservatively', () => {
    const d = (text: string) => detectSeniority('Software Engineer', undefined, text);
    expect(d('Requirements: 8+ years of experience building APIs.')).toBe('senior');
    expect(d('You have 5+ years of professional experience.')).toBe('senior');
    expect(d('3+ years of experience with Python.')).toBe('mid');
    expect(d('Minimum 3-5 years experience')).toBe('mid');
    expect(d('0-2 years of experience; new grads welcome.')).toBe('entry');
    expect(d('This role is great for new grads.')).toBe('entry');
    expect(d('This is an entry-level position.')).toBe('entry');
    expect(d('2+ years of Python experience and 6+ years of industry experience')).toBe('senior');
    expect(d('We have been in business for 10 years and have 10 years in business.')).toBe('unknown');
    expect(d('Founded 8 years ago, we are growing fast.')).toBe('unknown');
    expect(d('Our company has over 20 years of experience in logistics.')).toBe('unknown');
    expect(d('We are a 10 year old company with 8 years of profitable growth.')).toBe('unknown');
    expect(d('')).toBe('unknown');
  });
});

describe('detectEmploymentType', () => {
  it('maps source values', () => {
    const cases: Array<[string, string]> = [
      ['Full-time', 'full-time'], ['FULL_TIME', 'full-time'], ['fulltime', 'full-time'], ['Permanent', 'full-time'],
      ['Part time', 'part-time'], ['PART_TIME', 'part-time'], ['Contract', 'contract'], ['Contractor', 'contract'],
      ['C2C', 'contract'], ['W2', 'contract'], ['Temporary', 'temporary'], ['Temp', 'temporary'], ['Seasonal', 'temporary'],
      ['Intern', 'internship'], ['Internship', 'internship'], ['Freelance', 'freelance'], ['Volunteer', 'volunteer'],
      ['Vollzeit', 'full-time'], ['Teilzeit', 'part-time'], ['CDI', 'full-time'], ['CDD', 'contract'],
    ];
    for (const [v, want] of cases) expect([v, detectEmploymentType(v, 'Software Engineer')]).toEqual([v, want]);
    expect(detectEmploymentType('Other', 'Software Engineer')).toBe('unknown');
    expect(detectEmploymentType(undefined, 'Software Engineer')).toBe('unknown');
  });
  it('reads explicit title markers only', () => {
    expect(detectEmploymentType('Other', 'Data Engineer (Contract)')).toBe('contract');
    expect(detectEmploymentType(undefined, 'Machine Learning Engineer, LLM Inference [Contract]')).toBe('contract');
    expect(detectEmploymentType(undefined, 'Part-Time Bookkeeper')).toBe('part-time');
    expect(detectEmploymentType(undefined, 'Data Analyst Intern (Summer 2027)')).toBe('internship');
    expect(detectEmploymentType(undefined, 'Temporary Warehouse Associate')).toBe('temporary');
    expect(detectEmploymentType(undefined, 'Freelance Copywriter')).toBe('freelance');
    expect(detectEmploymentType(undefined, 'Seasonal Customer Love Associate')).toBe('temporary');
    expect(detectEmploymentType(undefined, 'Contract Manager')).toBe('unknown');
    expect(detectEmploymentType(undefined, 'Contracts Administrator')).toBe('unknown');
    expect(detectEmploymentType(undefined, 'Volunteer Coordinator')).toBe('unknown');
    expect(detectEmploymentType(undefined, 'Intern Coordinator')).toBe('unknown');
  });
  it('reads only unambiguous description statements', () => {
    const d = (text: string, title = 'Software Engineer') => detectEmploymentType(undefined, title, text);
    expect(d('This is a full-time position with benefits.')).toBe('full-time');
    expect(d('This is a 6-month contract.')).toBe('contract');
    expect(d('Employment type: Full-time')).toBe('full-time');
    expect(d('You will lead contract negotiation with vendors.', 'Procurement Specialist')).toBe('unknown');
    expect(d('Open to full-time students.', 'Tutor')).toBe('unknown');
    // conflicting statements: no guess
    expect(d('This is a full-time position. Initially a 6-month contract.')).toBe('unknown');
  });
});

describe('findRole / getRole', () => {
  it('ignores seniority and noise', () => {
    expect(findRole('senior swe')?.id).toBe('software-engineer');
    expect(findRole('Sr. Software Engineer II')?.id).toBe('software-engineer');
    expect(findRole('swe')?.id).toBe('software-engineer');
    expect(findRole('DATA SCIENTIST')?.id).toBe('data-scientist');
    expect(findRole('RN')?.id).toBe('registered-nurse');
    expect(findRole('Développeur Full Stack')?.id).toBe('full-stack-engineer');
  });
  it('returns undefined for unknown or empty input', () => {
    expect(findRole('qwerty')).toBeUndefined();
    expect(findRole('')).toBeUndefined();
    expect(findRole('   ')).toBeUndefined();
    expect(findRole('manager')).toBeUndefined();
    expect(findRole('engineer')).toBeUndefined();
  });
  it('looks roles up by id', () => {
    const r = getRole('software-engineer');
    expect(r?.title).toBe('Software Engineer');
    expect(r?.familyId).toBe('software-engineering');
    expect(r?.skills.length).toBeGreaterThan(0);
    expect(getRole('nope')).toBeUndefined();
    expect(getRole('')).toBeUndefined();
  });
});

describe('expandTitle', () => {
  it('returns synonyms without the input, canonical title first, and related roles in taxonomy order', () => {
    const e = expandTitle('Software Engineer');
    expect(e.role?.id).toBe('software-engineer');
    expect(e.synonyms).toContain('Software Developer');
    expect(e.synonyms.map((s) => s.toLowerCase())).not.toContain('software engineer');
    expect(e.related.map((r) => r.id)).toEqual(getRole('software-engineer')!.related);
    const d = expandTitle('software developer');
    expect(d.synonyms[0]).toBe('Software Engineer');
    expect(d.synonyms).not.toContain('Software Developer');
  });
  it('is seniority- and diacritic-insensitive', () => {
    const e = expandTitle('Senior Software Developer');
    expect(e.role?.id).toBe('software-engineer');
    expect(e.synonyms[0]).toBe('Software Engineer');
    expect(e.synonyms).not.toContain('Software Developer');
  });
  it('expands unknown titles to nothing', () => {
    expect(expandTitle('qwerty')).toEqual({ synonyms: [], related: [] });
    expect(expandTitle('')).toEqual({ synonyms: [], related: [] });
  });
});

describe('suggestTitles', () => {
  it('puts canonical prefix matches first', () => {
    expect(suggestTitles('soft')[0]).toEqual({ title: 'Software Engineer', roleId: 'software-engineer', family: expect.any(String) });
    expect(suggestTitles('DATA SCI')[0]?.title).toBe('Data Scientist');
    expect(suggestTitles('data eng')[0]?.title).toBe('Data Engineer');
  });
  it('finds word-prefix matches anywhere in the title', () => {
    const titles = suggestTitles('eng', 50).map((s) => s.title);
    expect(titles).toContain('Software Engineer');
    expect(titles).toContain('Engineering Manager');
    expect(titles.indexOf('Engineering Manager')).toBeLessThan(titles.indexOf('Software Engineer'));
    expect(suggestTitles('soft eng', 20).map((s) => s.title)).toContain('Software Engineer');
    expect(suggestTitles('man eng', 20).map((s) => s.title)).not.toContain('Engineering Manager');
  });
  it('returns aliases with their role, de-duplicated, within the limit', () => {
    const s = suggestTitles('swe', 10);
    expect(s.find((x) => x.title === 'SWE')?.roleId).toBe('software-engineer');
    const all = suggestTitles('a', 30);
    expect(all).toHaveLength(30);
    expect(new Set(all.map((x) => x.title.toLowerCase())).size).toBe(all.length);
    expect(suggestTitles('nurse', 3)).toHaveLength(3);
    expect(suggestTitles('')).toEqual([]);
    expect(suggestTitles('zzzzzz')).toEqual([]);
  });
  it('is fast', () => {
    suggestTitles('warm up');
    const t0 = performance.now();
    for (const q of ['s', 'so', 'sof', 'soft', 'e', 'en', 'eng', 'nurse', 'data', 'manag']) suggestTitles(q);
    expect((performance.now() - t0) / 10).toBeLessThan(5);
  });
});

describe('rolesForSkills', () => {
  it('ranks roles by weighted skill overlap', () => {
    const ids = rolesForSkills(['Python', 'SQL', 'Machine Learning', 'Statistics', 'TensorFlow']).map((r) => r.id);
    expect(ids.slice(0, 3)).toEqual(expect.arrayContaining(['machine-learning-engineer', 'data-scientist']));
    const nurse = rolesForSkills(['Patient Care', 'Basic Life Support', 'Medication Administration', 'Electronic Health Records']).map((r) => r.id);
    expect(nurse).toContain('registered-nurse');
    const acct = rolesForSkills(['Microsoft Excel', 'Accounting', 'General Ledger', 'Account Reconciliation']);
    expect(acct[0]?.familyId).toBe('finance-accounting');
  });
  it('is case-insensitive and needs at least two overlapping skills', () => {
    expect(rolesForSkills(['python'])).toEqual([]);
    expect(rolesForSkills(['python', 'sql', 'machine learning', 'statistics']).length).toBeGreaterThan(0);
    expect(rolesForSkills([])).toEqual([]);
    expect(rolesForSkills(['', '  '])).toEqual([]);
    expect(rolesForSkills(['Python', 'SQL'], 0)).toEqual([]);
  });
  it('diversifies families and respects the limit', () => {
    const r = rolesForSkills(['JavaScript', 'React', 'TypeScript', 'CSS', 'HTML', 'Node.js', 'Figma'], 6);
    expect(r.length).toBeLessThanOrEqual(6);
    expect(new Set(r.map((x) => x.id)).size).toBe(r.length);
    expect(new Set(r.map((x) => x.familyId)).size).toBeGreaterThan(1);
    expect(rolesForSkills(['JavaScript', 'React', 'TypeScript', 'CSS', 'HTML'], 2)).toHaveLength(2);
  });
});

describe('performance', () => {
  it('builds the role index quickly', () => {
    expect(roleIndexBuildMs()).toBeLessThan(300);
  });
  it('analyses many titles per second', () => {
    const sample = [
      'Senior Software Engineer, Backend (Remote - US)', 'Registered Nurse (RN) - ICU - Nights', 'Account Executive, Mid-Market (French speaking)',
      'Werkstudent (m/w/d) Marketing', 'Travel Nurse RN - Med Surg - $2,450 per week', 'Product Manager', 'Staff Software Engineer (L6)',
      'Customer Success Manager - DACH', 'Data Analyst Intern (Summer 2027)', 'Director of Engineering',
    ];
    for (const t of sample) analyzeTitle(t);
    let n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 200) for (const t of sample) (analyzeTitle(t), n++);
    const perSec = (n / (performance.now() - t0)) * 1000;
    // > 50,000/s on a developer machine; a loose floor here keeps the test stable on slow CI
    expect(perSec).toBeGreaterThan(10_000);
  });
});
