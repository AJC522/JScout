import { useBootstrap } from '../../app/bootstrap';
import { SectionCard } from '../profile/SectionCard';
import { useSources } from './settings-api';

const LINK = 'font-medium text-primary underline-offset-2 hover:underline';

const OPEN_SOURCE = ['React', 'Fastify', 'SQLite', 'TanStack Query', 'Radix UI', 'Tailwind CSS', 'Lucide icons', 'zod', 'unpdf', 'mammoth'];

export function AboutSection() {
  const version = useBootstrap().data?.version;
  const sources = useSources();

  return (
    <SectionCard id="about" title="About JScout" description={version ? `Version ${version}` : undefined}>
      <div className="flex flex-col gap-4 text-sm text-muted">
        <div>
          <h3 className="mb-1 font-semibold text-fg">Job data</h3>
          <p>Jobs come from these sources and belong to them and the employers who posted them:</p>
          {sources.data && sources.data.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {sources.data.map((source) => (
                <li key={source.id}>
                  <a href={source.homepage} target="_blank" rel="noreferrer" className={LINK}>
                    {source.name}
                  </a>
                  {source.attribution ? <span> · {source.attribution}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">Each job links back to the site it came from.</p>
          )}
        </div>
        <div>
          <h3 className="mb-1 font-semibold text-fg">Location data</h3>
          <p>
            Place names and coordinates from{' '}
            <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className={LINK}>
              GeoNames
            </a>
            , licensed under{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className={LINK}>
              CC BY 4.0
            </a>
            .
          </p>
        </div>
        <div>
          <h3 className="mb-1 font-semibold text-fg">Built with open-source software</h3>
          <p>Including {OPEN_SOURCE.join(', ')}. Thank you to everyone who maintains them.</p>
        </div>
      </div>
    </SectionCard>
  );
}
