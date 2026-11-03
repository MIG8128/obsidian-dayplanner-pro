// DayPlannerBaseView: the layer classes assembled into the base every planner view extends.
import { ListLayer } from './listView';

/**
 * The planner view base, assembled from one class per concern (each extends the one before):
 * PlannerViewCore → DragDropLayer → TimelineLayer → MonthLayer → BoardLayer → ListLayer → DayPlannerBaseView.
 */
export abstract class DayPlannerBaseView extends ListLayer {}
