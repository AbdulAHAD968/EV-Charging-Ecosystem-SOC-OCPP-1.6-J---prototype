import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Site from './pages/Site.jsx';
import Dashboard from './pages/Dashboard.jsx';

const Attacks = lazy(() => import('./pages/Attacks.jsx'));
const Inspector = lazy(() => import('./pages/Inspector.jsx'));
const Learn = lazy(() => import('./pages/Learn.jsx'));
const Scorecard = lazy(() => import('./pages/Scorecard.jsx'));

class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) return <div className="page"><div className="card">This page failed to load.</div></div>;
    return this.props.children;
  }
}

const wrap = (el) => (
  <Boundary><Suspense fallback={<div className="page muted">Loading...</div>}>{el}</Suspense></Boundary>
);

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Site />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/attacks" element={wrap(<Attacks />)} />
        <Route path="/inspector" element={wrap(<Inspector />)} />
        <Route path="/learn" element={wrap(<Learn />)} />
        <Route path="/scorecard" element={wrap(<Scorecard />)} />
        <Route path="*" element={<Site />} />
      </Routes>
    </Layout>
  );
}
