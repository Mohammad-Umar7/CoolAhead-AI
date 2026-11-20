import { ROOMS, SURPRISES, TIMETABLE, fmtTime } from '../engine/config';
import type { Decision } from '../engine/types';
import { OUTREACH, type Scene } from './cycle';

/**
 * The liaison agents: the part of CoolAhead that talks to people outside the
 * control loop. Each one has a single department, and is called only when a
 * decision turns up something that department has to hear about. They never
 * change the cooling. The reply goes back to the orchestrator.
 *
 * The departments are simulated: the prototype has no link to the university's
 * systems, so each reply here is written into the test day, like the events
 * themselves.
 */
export interface Liaison {
  id: 'maintenance' | 'timetable' | 'events';
  agent: string;
  dept: string;
  /** the department's initials, for its mark in the conversation */
  mark: string;
  /** why the orchestrator calls this agent */
  why: string;
  lines: { who: 'agent' | 'dept'; text: string }[];
  /** what the conversation settled, in two or three words */
  outcome: string;
  /** what the agent brings back to the orchestrator */
  report: string;
  /** what Forecast knows once the orchestrator has passed the answer on, where the answer changes the next hour */
  forecast?: string;
}

export function liaisonFor(scene: Scene, d: Decision): Liaison | null {
  if (!OUTREACH.has(scene.id)) return null;

  if (scene.id === 'camera') {
    const out = SURPRISES.cameraOut;
    const room = ROOMS[out.room].id;
    return {
      id: 'maintenance',
      agent: 'Maintenance agent',
      dept: 'Facilities desk',
      mark: 'FD',
      why: `The ${room} camera is down. Facilities has to know.`,
      lines: [
        { who: 'agent', text: `CAM-0${out.room + 1} in ${room} went dark at ${fmtTime(out.start)}, mid-class. Cooling is held on the timetable.` },
        { who: 'dept', text: 'Thanks. A technician is on the way.' },
        { who: 'agent', text: 'I will go back to live counts when it returns.' },
      ],
      outcome: 'Work order opened',
      report: 'Facilities is sending a technician. Cooling stays held until the camera is back.',
    };
  }

  if (scene.id === 'noshow') {
    const block = TIMETABLE[SURPRISES.noShowBlock];
    const room = ROOMS[block.room].id;
    return {
      id: 'timetable',
      agent: 'Timetable agent',
      dept: "Registrar's office",
      mark: 'RO',
      why: `${block.code} is on the timetable, but nobody came. The registrar should know.`,
      lines: [
        { who: 'agent', text: `${block.code} is listed in ${room} at ${fmtTime(block.start)}, but the room is empty. Cancelled?` },
        { who: 'dept', text: 'Yes, cancelled this morning. The timetable was not updated.' },
        { who: 'agent', text: `Got it. Forecast now has ${room} free until ${fmtTime(block.end)}.` },
      ],
      outcome: 'Timetable corrected',
      report: `${block.code} was cancelled. Forecast now has ${room} free until ${fmtTime(block.end)}.`,
      forecast: `Cancelled: ${room} free until ${fmtTime(block.end)}`,
    };
  }

  const surge = SURPRISES.surge;
  const room = ROOMS[surge.room].id;
  const seen = d.vision.count[surge.room] ?? surge.people;
  return {
    id: 'events',
    agent: 'Events agent',
    dept: 'Events office',
    mark: 'EO',
    why: `A crowd is in ${room} with nothing booked. The events office should know.`,
    lines: [
      { who: 'agent', text: `${seen} people just walked into ${room} and nothing is booked. Is this an event?` },
      { who: 'dept', text: `Yes, a guest talk, booked late. It runs until ${fmtTime(surge.end)}.` },
      { who: 'agent', text: `Thanks. Forecast holds ${room} as in use until ${fmtTime(surge.end)}.` },
    ],
    outcome: 'Booking added',
    report: `It is a guest talk until ${fmtTime(surge.end)}. Forecast holds ${room} as in use.`,
    forecast: `Guest talk in ${room} until ${fmtTime(surge.end)}`,
  };
}
