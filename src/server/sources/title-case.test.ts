import { describe, expect, it } from 'vitest';
import { recaseTitle } from './title-case';

describe('recaseTitle', () => {
  it('re-cases titles written entirely in capitals, keeping acronyms, numerals and codes', () => {
    expect(recaseTitle('POLICE OFFICER II - K9 UNIT')).toBe('Police Officer II - K9 Unit');
    expect(recaseTitle("SHERIFF'S TECHNOLOGY SPECIALIST")).toBe("Sheriff's Technology Specialist");
    expect(recaseTitle('GIS ANALYST FOR THE DEPARTMENT OF PUBLIC WORKS')).toBe('GIS Analyst for the Department of Public Works');
    expect(recaseTitle('IT CYBERSECURITY SPECIALIST (INFOSEC)')).toBe('IT Cybersecurity Specialist (INFOSEC)');
    expect(recaseTitle('IT SPECIALIST (APPSW/DATAMGT)')).toBe('IT Specialist (APPSW/DATAMGT)');
    expect(recaseTitle('CRIMINAL INVESTIGATOR (FBI) GS-1811-13')).toBe('Criminal Investigator (FBI) GS-1811-13');
  });

  it('leaves titles with any lower-case letter, and very short ones, alone', () => {
    expect(recaseTitle('IT Specialist (INFOSEC)')).toBe('IT Specialist (INFOSEC)');
    expect(recaseTitle('911')).toBe('911');
    expect(recaseTitle('RN')).toBe('RN');
  });
});
