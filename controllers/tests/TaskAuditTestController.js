const BaseController = require('../BaseController');
const TaskAuditTestService = require('../../services/TaskAuditTestService');

/**
 * @swagger
 * tags:
 *   - name: Audit Test
 */
class TaskAuditTestController extends BaseController {
  constructor() {
    super();
    this.service = new TaskAuditTestService();
  }

  /**
   * @swagger
   * /test/create-task-audit:
   *   post:
   *     summary: Tạo audit từ task + task_users
   *     tags: [Audit Test]
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               user_id:
   *                 type: string
   *                 default: "6915f2387e39c2ba33cef79a"
   *               role:
   *                 type: string
   *                 default: "NGUOI_CHU_CHI"
   *               action_code:
   *                 type: string
   *                 default: "PHE_DUYET"
   *               to_node_id:
   *                 type: string
   *                 default: "Event_0uchici"
   *               details:
   *                 type: string
   *                 default: '{"note":"he duyet cho toi"}'
   *               action:
   *                 type: string
   *                 default: "Đồng ý phê duyệt"
   *               stage_status:
   *                 type: string
   *                 default: "PHE_DUYET"
   *               type_document:
   *                 type: string
   *                 default: "Task"
   */
  create = this.asyncHandler(async (req, res) => {
    await this.service.initialize();

    const dto = {
      user_id: req.body.user_id ?? '6915f2387e39c2ba33cef79a',
      display_name: null,
      role: req.body.role ?? 'NGUOI_CHU_CHI',
      action_code: req.body.action_code ?? 'PHE_DUYET',
      from_node_id: null,
      to_node_id: req.body.to_node_id ?? 'Event_0uchici',
      details: req.body.details ?? '{"note":"he duyet cho toi"}',
      created_by: req.body.user_id ?? '6915f2387e39c2ba33cef79a',
      receiver: req.body.user_id ?? '6915f2387e39c2ba33cef79a',
      receiver_unit: null,
      group_: null,
      roleProcess: null,
      action: req.body.action ?? 'Đồng ý phê duyệt',
      deadline: null,
      stage_status: req.body.stage_status ?? 'PHE_DUYET',
      curStatusCode: null,
      type_document: req.body.type_document ?? 'Task',
      processed_by: req.body.user_id ?? '6915f2387e39c2ba33cef79a',
      acting_as: null
    };

    const result = await this.service.createAudit(dto);
    return this.success(res, result, 'Tạo audit task thành công');
  });
}

module.exports = new TaskAuditTestController();
