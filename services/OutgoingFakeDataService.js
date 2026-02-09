const OutgoingFakeDataModel =
  require('../models/OutgoingFakeDataModel');

class OutgoingFakeDataService {
  constructor() {
    this.model = new OutgoingFakeDataModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async fake(payload) {
    const { senderUnit, drafter } = payload;

    if (!senderUnit || !drafter) {
      throw new Error('senderUnit và drafter là bắt buộc');
    }

    const start = Date.now();
    const result = await this.model.fakeAllOnce({ senderUnit, drafter });
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    return {
      success: true,
      affected: result.affected,
      dbDurationSeconds: result.duration_seconds,
      apiDurationSeconds: duration
    };
  }
}

module.exports = OutgoingFakeDataService;
