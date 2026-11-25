import { describe, expect, it, vi } from 'vitest';
import { WARNINGS, analyzeResumeText } from './resume-analysis';

vi.mock('../../lib/skills', async () => (await import('./test-fakes')).skillsModule);
vi.mock('../../lib/titles', async () => (await import('./test-fakes')).titlesModule);
vi.mock('../../lib/location', async () => (await import('./test-fakes')).locationModule);

const NOW = new Date('2026-11-25T12:00:00Z');
const analyze = (text: string, mimeType?: string) => analyzeResumeText(text, { now: NOW, mimeType });
const jobs = (text: string) => analyze(text).experience.map(({ title, company, location, start, end, current }) => ({ title, company, location, start, end, current }));

const ENGINEER = `Jane Doe
Austin, TX 78701 | (512) 555-0142 | jane.doe@example.com
linkedin.com/in/jane-doe | github.com/janedoe | janedoe.dev

SUMMARY
Backend engineer with 8 years of experience building payment systems.

EXPERIENCE
Senior Software Engineer, Acme Corp          Jan 2020 – Present
• Built billing APIs in TypeScript and Go, processing $2B a year.
• Led migration from a monolith to Kubernetes services, cutting
  deploy times by 80%.
Software Engineer, Initech, Inc.             Jun 2016 - Dec 2019
• Maintained Node.js services backed by PostgreSQL.
Software Engineering Intern | Globex | Summer 2015
- Wrote internal tools in Python.

EDUCATION
B.S. Computer Science, University of Texas at Austin, 2012 - 2016

SKILLS
TypeScript, Go, Node.js, PostgreSQL, AWS, Docker, Terraform
`;

// What mammoth produces for a Word résumé: paragraphs separated by blank lines, tabs before dates, no bullet glyphs.
const ANALYST_DOCX = `Priya Raman

Seattle, WA | priya.raman@example.com | (206) 555-0188 | LinkedIn

Experience

Senior Data Analyst\tMar 2021 – Present

Northwind Analytics, Seattle, WA

Built Tableau dashboards used by 40 account managers.

Automated weekly reporting with Python and SQL, saving 6 hours a week.

Data Analyst\tJun 2018 – Feb 2021

Contoso Retail, Portland, OR

Analysed pricing experiments across 120 stores.

Education

University of Washington

B.S. in Statistics, 2014 – 2018

Skills

SQL, Python, Tableau, Excel, dbt
`;

const NURSE = `MARIA L. GONZALEZ, RN, BSN
1450 Oak Street, Apt 3, Tampa, FL 33602
Mobile: 813.555.0199  •  maria.gonzalez.rn@gmail.com

Professional Summary
Compassionate registered nurse with experience in emergency and
medical-surgical units. Skilled in patient care, IV therapy and Epic charting.

Clinical Experience
Tampa General Hospital, Tampa, FL
Charge Nurse, Emergency Department
08/2019 - Present
- Coordinate care for a 32-bed emergency department across 12-hour shifts.
- Precept new graduate nurses.

St. Joseph's Hospital, Tampa, FL
Staff Nurse, Medical-Surgical Unit
05/2016 - 07/2019
- Provided patient care for up to 6 patients per shift.

Education
Bachelor of Science in Nursing
University of South Florida, Tampa, FL
May 2016

Licenses & Certifications
Registered Nurse, Florida Board of Nursing, License #RN9123456 (exp. 2027)
BLS, ACLS, PALS
`;

const ACCOUNTANT = `Robert Chen, CPA
Toronto, Canada
+1 416 555 0123 · robert.chen@outlook.com

PROFESSIONAL EXPERIENCE

Senior Accountant — Maple Leaf Foods Inc. — Toronto, ON
03/2021 – present
* Prepare monthly financial reporting under GAAP for a $400M division.
* Reconcile 40+ balance-sheet accounts in SAP.

Staff Accountant — Bright & Co. Chartered Accountants
2017 – 2021
* Managed bookkeeping for small-business clients in QuickBooks.

EDUCATION
Bachelor of Commerce, Accounting — University of Toronto (2013 - 2017)

CERTIFICATIONS
CPA, Chartered Professional Accountants of Ontario, 2019
`;

const MARKDOWN = `# Alex Kim

alex@kim.io · +44 20 7946 0958 · London, UK · https://alexkim.dev

## Work history

### Frontend Engineer at Monzo Bank
*April 2022 to Present*

- Rebuilt the onboarding flow in React and TypeScript.

### Front-end Developer @ Deliveroo
*2019 - 2022*

- Shipped the restaurant dashboard.

## Education

**MSc Human-Computer Interaction**, University College London, 2018 - 2019
`;

const MESSY = `curriculum vitae
sam taylor
sam.taylor@example.org
Office hours 2019-2021, zip 90210, ref 03/2018
Things I have done:
worked at a cafe 2015 - 2017 making coffee and talking with customers about their day and so on and so forth
volunteered at the library teaching seniors how to use email and spreadsheets in Excel
`;

describe('contact details', () => {
  it('reads name, email, phone, location and links from a classic header', () => {
    expect(analyze(ENGINEER).contact).toEqual({
      fullName: 'Jane Doe',
      email: 'jane.doe@example.com',
      phone: '(512) 555-0142',
      location: 'Austin, TX',
      linkedin: 'https://linkedin.com/in/jane-doe',
      github: 'https://github.com/janedoe',
      website: 'https://janedoe.dev',
    });
  });

  it('handles all-caps names with credentials, labelled dotted phones and street addresses', () => {
    expect(analyze(NURSE).contact).toEqual({
      fullName: 'Maria L. Gonzalez',
      email: 'maria.gonzalez.rn@gmail.com',
      phone: '813.555.0199',
      location: 'Tampa, FL',
    });
  });

  it('confirms "City, Country" with the gazetteer and reads international phones', () => {
    expect(analyze(ACCOUNTANT).contact).toMatchObject({ fullName: 'Robert Chen', phone: '+1 416 555 0123', location: 'Toronto, Canada' });
    expect(analyze(MARKDOWN).contact).toEqual({
      fullName: 'Alex Kim',
      email: 'alex@kim.io',
      phone: '+44 20 7946 0958',
      location: 'London, UK',
      website: 'https://alexkim.dev',
    });
  });

  it('does not mistake dates or zip codes for a phone number, nor a lower-case line for a name', () => {
    const contact = analyze(MESSY).contact;
    expect(contact).toEqual({ email: 'sam.taylor@example.org' });
  });

  it('only accepts a name-like first line', () => {
    expect(analyze('Senior Software Engineer\njane@example.com').contact.fullName).toBeUndefined();
    expect(analyze('José María García-López\nExperience').contact.fullName).toBe('José María García-López');
    expect(analyze('Vincent van Gogh | Painter\nx').contact.fullName).toBe('Vincent van Gogh');
    expect(analyze('Résumé\nAda Lovelace\nada@example.com').contact.fullName).toBe('Ada Lovelace');
    expect(analyze('Acme Corp 2024\nx').contact.fullName).toBeUndefined();
  });
});

describe('experience', () => {
  it('reads title, company and dates when they share a line, including seasons', () => {
    expect(jobs(ENGINEER)).toEqual([
      { title: 'Senior Software Engineer', company: 'Acme Corp', location: '', start: '2020-01', end: '', current: true },
      { title: 'Software Engineer', company: 'Initech, Inc.', location: '', start: '2016-06', end: '2019-12', current: false },
      { title: 'Software Engineering Intern', company: 'Globex', location: '', start: '2015-06', end: '2015-08', current: false },
    ]);
  });

  it('keeps bullets as highlights and joins wrapped bullet lines', () => {
    const [first] = analyze(ENGINEER).experience;
    expect(first?.highlights).toEqual([
      'Built billing APIs in TypeScript and Go, processing $2B a year.',
      'Led migration from a monolith to Kubernetes services, cutting deploy times by 80%.',
    ]);
  });

  it('reads Word output where the employer and place follow the dated title line', () => {
    const result = analyze(ANALYST_DOCX);
    expect(jobs(ANALYST_DOCX)).toEqual([
      { title: 'Senior Data Analyst', company: 'Northwind Analytics', location: 'Seattle, WA', start: '2021-03', end: '', current: true },
      { title: 'Data Analyst', company: 'Contoso Retail', location: 'Portland, OR', start: '2018-06', end: '2021-02', current: false },
    ]);
    expect(result.experience[0]?.highlights).toEqual([
      'Built Tableau dashboards used by 40 account managers.',
      'Automated weekly reporting with Python and SQL, saving 6 hours a week.',
    ]);
    expect(result.education).toMatchObject([{ school: 'University of Washington', degree: 'B.S.', field: 'Statistics', start: '2014', end: '2018' }]);
  });

  it('reads a nurse résumé where employer and title come before numeric dates', () => {
    expect(jobs(NURSE)).toEqual([
      { title: 'Charge Nurse', company: 'Tampa General Hospital', location: 'Tampa, FL', start: '2019-08', end: '', current: true },
      { title: 'Staff Nurse', company: "St. Joseph's Hospital", location: 'Tampa, FL', start: '2016-05', end: '2019-07', current: false },
    ]);
  });

  it('reads em-dash separated headers with dates on the next line', () => {
    expect(jobs(ACCOUNTANT)).toEqual([
      { title: 'Senior Accountant', company: 'Maple Leaf Foods Inc.', location: 'Toronto, ON', start: '2021-03', end: '', current: true },
      { title: 'Staff Accountant', company: 'Bright & Co. Chartered Accountants', location: '', start: '2017', end: '2021', current: false },
    ]);
  });

  it('reads "Title at Company" and "Title @ Company" headers in Markdown', () => {
    expect(jobs(MARKDOWN)).toEqual([
      { title: 'Frontend Engineer', company: 'Monzo Bank', location: '', start: '2022-04', end: '', current: true },
      { title: 'Front-end Developer', company: 'Deliveroo', location: '', start: '2019', end: '2022', current: false },
    ]);
  });
});

describe('education', () => {
  it('reads degree, field, school and years', () => {
    expect(analyze(ENGINEER).education).toMatchObject([
      { school: 'University of Texas at Austin', degree: 'B.S.', field: 'Computer Science', start: '2012', end: '2016' },
    ]);
    expect(analyze(NURSE).education).toMatchObject([
      { school: 'University of South Florida', degree: 'Bachelor of Science', field: 'Nursing', start: '', end: '2016-05' },
    ]);
    expect(analyze(ACCOUNTANT).education).toMatchObject([
      { school: 'University of Toronto', degree: 'Bachelor of Commerce', field: 'Accounting', start: '2013', end: '2017' },
    ]);
    expect(analyze(MARKDOWN).education).toMatchObject([
      { school: 'University College London', degree: 'MSc', field: 'Human-Computer Interaction', start: '2018', end: '2019' },
    ]);
  });

  it('does not read a state abbreviation as a degree', () => {
    const text = 'Jo Bloggs\n\nEducation\nHarvard University, Cambridge, MA\nMBA, Finance, 2015 - 2017\n';
    expect(analyze(text).education).toMatchObject([{ school: 'Harvard University', degree: 'MBA', field: 'Finance', start: '2015', end: '2017' }]);
  });
});

describe('titles, skills and years', () => {
  it('maps titles to roles and suggests targets, most recent first', () => {
    const result = analyze(ENGINEER);
    expect(result.titles).toEqual([
      { title: 'Senior Software Engineer', roleId: 'software-engineer' },
      { title: 'Software Engineer', roleId: 'software-engineer' },
      { title: 'Software Engineering Intern', roleId: 'engineering-intern' },
    ]);
    expect(result.suggestedTitles[0]).toBe('Software Engineer');
    expect(result.suggestedTitles).toContain('Software Engineering Intern');
    expect(new Set(result.suggestedTitles).size).toBe(result.suggestedTitles.length);
    expect(result.suggestedTitles.length).toBeLessThanOrEqual(8);
    expect(result.skills).toEqual(expect.arrayContaining(['TypeScript', 'Go', 'Kubernetes', 'Node.js', 'PostgreSQL', 'Python', 'AWS']));
  });

  it('maps a non-tech résumé the same way', () => {
    const result = analyze(NURSE);
    expect(result.titles).toEqual([
      { title: 'Charge Nurse', roleId: 'registered-nurse' },
      { title: 'Staff Nurse', roleId: 'registered-nurse' },
    ]);
    expect(result.suggestedTitles).toEqual(['Registered Nurse']);
    expect(result.skills).toEqual(['Patient care', 'IV therapy', 'Epic']);
  });

  it('fills suggestions from skills when titles are not recognised', () => {
    const text = 'Experience\nShift Supervisor, Blue Bottle Coffee  2019 - 2021\n• Kept the books in QuickBooks and Excel.\n';
    const result = analyze(text);
    expect(result.titles).toEqual([{ title: 'Shift Supervisor' }]);
    expect(result.suggestedTitles).toEqual(['Accountant', 'Data Analyst', 'Bookkeeper']);
  });

  it('merges overlapping ranges and caps "Present" at today', () => {
    // Jan 2020 – Nov 2026 (83 months) + Jun 2016 – Dec 2019 (43) + Jun – Aug 2015 (3) = 129 months.
    expect(analyze(ENGINEER).yearsExperience).toBe(10.8);
    const overlapping = 'Experience\nEngineer, A  2018 - 2020\nConsultant, B  2019 - 2021\n';
    // Year-only dates count from mid-year: Jun 2018 – Jun 2021.
    expect(analyze(overlapping).yearsExperience).toBe(3.1);
  });
});

describe('warnings', () => {
  it('flags a résumé without an experience section, without inventing jobs', () => {
    const result = analyze(MESSY);
    expect(result.experience).toEqual([]);
    expect(result.yearsExperience).toBeNull();
    expect(result.warnings).toContain(WARNINGS.noExperienceSection);
  });

  it('flags an experience section without dated jobs', () => {
    const text = `Jordan Lee\n\nExperience\nWorked on many things at various companies over the years, see LinkedIn for the details of each role.\nAlso freelance work for clients in several industries including retail, logistics and healthcare.`;
    expect(analyze(text).warnings).toEqual([WARNINGS.noDatedJobs]);
  });

  it('flags an image-only PDF and an empty résumé', () => {
    expect(analyze('', 'application/pdf').warnings).toEqual([WARNINGS.scanned]);
    expect(analyze('Page 1', 'application/pdf').warnings).toEqual([WARNINGS.scanned]);
    expect(analyze('').warnings).toEqual([WARNINGS.noResume]);
    expect(analyze('Jane Doe\njane@example.com').warnings).toEqual([WARNINGS.littleText]);
  });
});
