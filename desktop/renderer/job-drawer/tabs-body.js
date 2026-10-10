// The drawer's tab bodies by key: one module per tab (tab-*.js), each takes {job, page, parts} and returns nodes.
import {applicationTab} from './tab-application.js';
import {descriptionTab} from './tab-description.js';
import {interviewsTab} from './tab-interviews.js';
import {matchTab} from './tab-match.js';
import {messagesTab} from './tab-messages.js';
import {overviewTab} from './tab-overview.js';
import {reviewTab} from './tab-review.js';
import {timelineTab} from './tab-timeline.js';

export const BODIES = {overview: overviewTab, match: matchTab, description: descriptionTab, application: applicationTab,
  interviews: interviewsTab, review: reviewTab, messages: messagesTab, timeline: timelineTab};
