import { useState } from 'react';
import { QUIZ } from '../../data/lessons';
import { LiveLink } from './Seq';

export default function Quiz() {
  const [answers, setAnswers] = useState({});
  const done = Object.keys(answers).length;
  const score = QUIZ.filter((q, i) => answers[i] === q.a).length;
  return (
    <div>
      <h2 className="lrn-h2">Quiz</h2>
      <p className="lrn-p">Six questions. Pick an answer to see feedback straight away.</p>
      {QUIZ.map((q, i) => {
        const chosen = answers[i];
        const answered = chosen !== undefined;
        return (
          <fieldset key={i} className="lrn-q">
            <legend>{i + 1}. {q.q}</legend>
            {q.o.map((o, j) => (
              <label key={j} className={`lrn-opt ${answered && j === q.a ? 'right' : ''} ${answered && j === chosen && j !== q.a ? 'wrong' : ''}`}>
                <input type="radio" name={`q${i}`} disabled={answered} checked={chosen === j} onChange={() => setAnswers({ ...answers, [i]: j })} /> {o}
              </label>
            ))}
            {answered ? <div className="lrn-feedback" aria-live="polite">{chosen === q.a ? 'Correct. ' : 'Not quite. '}{q.why}</div> : null}
          </fieldset>
        );
      })}
      <div className="lrn-score">Score: {score} / {QUIZ.length}{done === QUIZ.length ? ' (finished)' : ''}
        <button className="lrn-btn lrn-btn-sm" onClick={() => setAnswers({})}>Retry</button>
      </div>
      <LiveLink />
    </div>
  );
}
