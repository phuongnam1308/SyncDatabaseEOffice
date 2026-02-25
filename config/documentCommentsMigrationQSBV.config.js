module.exports = {
  documentCommentsMigration: {
    source: {
      database: 'DataEOfficeSNP',
      schema: 'dbo',
      table: 'Comments'
    },

    target: {
      database: 'DiOffice',
      schema: 'dbo',
      table: 'document_comments2'
    },

    tableBakName: 'Comments_QSBV',

    mapping: {
      id_comments_bak: 'ID',
      ItemTitle: 'ItemTitle',
      ItemUrl: 'ItemUrl',
      ItemImage: 'ItemImage',
      DocumentID_bak: 'DocumentID',
      Category: 'Category',
      Type_bak: 'Type',
      Email: 'Email',
      Author: 'Author',
      content: 'Content',
      user_id_bak: 'Created',
      parent_id_bak: 'CommentID',
      EmailReplyTo: 'EmailReplyTo',
      ReplyTo: 'ReplyTo',
      Files: 'Files',
      LikeNumber: 'LikeNumber'
    },

    defaultFields: {
      is_edited: 0,
      is_leader_suggestion: 0
    }
  }
};
