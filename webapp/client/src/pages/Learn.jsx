import { useState } from 'react';
import { LESSONS } from '../data/lessons';
import Handshake from './learn/Handshake';
import Anatomy from './learn/Anatomy';
import { Session, BreakIt } from './learn/Session';
import Quiz from './learn/Quiz';
import './Learn.css';

const VIEWS = { handshake: Handshake, anatomy: Anatomy, session: Session, break: BreakIt, quiz: Quiz };

export default function Learn() {
  const [id, setId] = useState('handshake');
  const View = VIEWS[id];
  return (
    <div className="lrn-page">
      <h1 className="lrn-h1">OCPP Protocol Lab</h1>
      <div className="lrn-layout">
        <nav className="lrn-nav" aria-label="Lessons">
          {LESSONS.map((l, i) => (
            <button key={l.id} className={`lrn-lesson ${id === l.id ? 'on' : ''}`} onClick={() => setId(l.id)} aria-current={id === l.id ? 'page' : undefined}>
              <span className="lrn-lnum">{i + 1}</span>
              <span><span className="lrn-ltitle">{l.title}</span><span className="lrn-lblurb">{l.blurb}</span></span>
            </button>
          ))}
        </nav>
        <main className="lrn-stage"><View key={id} /></main>
      </div>
    </div>
  );
}
