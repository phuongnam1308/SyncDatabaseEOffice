const FileMigrationModel = require('./FileMigrationModel');
const BaseModel = require("../../../models/BaseModel");

class StreamFileMigrationModel extends BaseModel {
    constructor() {
        super();
        //WSS_Content_eoffice_khkd
        this.dbName = 'camunda';
        this.oldDbSchema = "dbo";
        this.oldDbTable = "AllDocs";
        this.newDbSchema = "dbo";
        this.newDbTable = "all_docs_sync";
        this.helper = new MigrationHelper(this.queryNewDbTx.bind(this));
    }

}
module.exports = StreamFileMigrationModel;

