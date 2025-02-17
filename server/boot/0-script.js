"use strict";

module.exports = function (app) {
  const logger = require("../../common/logger");

  var dataSource = app.datasources.mongo;
  console.log(
    "Datasource host %s, database %s",
    dataSource.connector.settings.host,
    dataSource.connector.settings.database
  );

  dataSource.autoupdate(function (err, result) {
    if (err) {
      console.log("Database Autoupdate error: %s", err);
    } else {
      console.log("Database Autoupdate result: %s", result);
    }
  });

  var loopback = require("loopback");
  var DataModel = loopback.PersistedModel;

  console.log("Adding ACLS for UserIdentity");

  DataModel.extend("UserIdentity", null, {
    acls: [{
      principalType: "ROLE",
      principalId: "$everyone",
      permission: "DENY"
    },
    {
      accessType: "READ",
      principalType: "ROLE",
      principalId: "$authenticated",
      permission: "ALLOW"
    }
    ]
  });

  dataSource.connector.connect(function (err, db) {

    // verify that ObjectIds have been replaced by UUIDv4 strings
    db.collection("Policy").countDocuments({
      $or: [{
        "_id": {
          "$regex": /^[a-f\d]{24}$/i
        }
      }, {
        "_id": {
          "$type": "objectId"
        }
      }]
    }, function (err, res) {
      if (res != 0) {
        console.error("=============================================");
        console.error("=============================================");
        console.error("=============================================");
        console.error("=============================================");
        console.error("=============================================");
        console.error("=============================================");
        console.error();
        console.error("   Warning: your DB contains old ID format   ");
        console.error("   please run the script                     ");
        console.error("   == backend/scripts/replaceObjectIds.sh == ");
        console.error("   on your mongo DB !                        ");
        console.error();
        console.error("========================================");
        console.error("========================================");
        console.error("========================================");
        console.error("========================================");
        console.error("========================================");
      } else {
        console.log("Mongo DB already translated to new ID format");
      }
    });

    // add index to embedded fields, dont wait for result
    var embedFields = [
      "datasetlifecycle.archivable",
      "datasetlifecycle.retrievable",
      "datasetlifecycle.publishable",
      "datasetlifecycle.archiveStatusMessage",
      "datasetlifecycle.retrieveStatusMessage"
    ];

    embedFields.forEach(function (field) {
      db.collection("Dataset").createIndex({
        field: 1
      },
      function (err) {
        if (!err) {
          console.log(
            "Index on field " + field + " created successfully"
          );
        } else {
          console.log(err);
        }
      }
      );
    });

    var textSearchCollections = [
      "Dataset", "Sample", "Proposal", "OrigDatablock", "Job", "PublishedData", "Logbook", "Policy", "Instrument"
    ];
    textSearchCollections.forEach(function (coll) {
      db.collection(coll).createIndex({
        "$**": "text"
      },
      function (err) {
        if (!err) {
          console.log("Text Index on " + coll + " created successfully");
        } else {
          console.log(err);
        }
      }
      );
    });
  });

  // add further information to options parameter
  // see https://loopback.io/doc/en/lb3/Using-current-context.html#use-a-custom-strong-remoting-phase

  app.remotes()
    .phases.addBefore("invoke", "options-from-request")
    .use(function (ctx, next) {
      // console.log("============ Phase: args,options modelname", ctx.method.sharedClass.name)
      // add model name to context options
      if (!ctx.args.options)
        return next();
      ctx.args.options.modelName = ctx.method.sharedClass.name;
      if (!ctx.args.options.accessToken)
        return next();
      const User = app.models.User;
      const UserIdentity = app.models.UserIdentity;
      const RoleMapping = app.models.RoleMapping;
      const Role = app.models.Role;
      // first check if email in User
      User.findById(ctx.args.options.accessToken.userId, function (
        err,
        user
      ) {
        if (err) return next(err);
        // console.log("Found user:", user)
        ctx.args.options.currentUser = user.username;
        // get email from User for functional accounts and from UserIdentity for normal users
        ctx.args.options.currentUserEmail = user.email;
        UserIdentity.findOne({
          //json filter
          where: {
            userId: ctx.args.options.accessToken.userId
          }
        },
        function (err, u) {
          // add user email and groups
          if (u) {
            var groups = [];
            if (u.profile) {
              // console.log("Profile:", u.profile)
              // if user account update where query to append group groupCondition
              ctx.args.options.currentUser =
                                    u.profile.username;
              ctx.args.options.currentUserEmail =
                                    u.profile.email;
              if (!u.profile.accessGroups) {
                groups = [];
              } else if (u.profile.accessGroups instanceof Array) {
                groups = u.profile.accessGroups;
              } else {
                return next(new Error("accessGroups type mismatch"));
              }
              groups.push(u.profile.email || "empty.mail@loopback-scicatproject");
              // check if a normal user or an internal ROLE
              if (typeof groups === "undefined") {
                groups = [];
              }
              ctx.args.options.currentGroups = groups;
              // console.log("============ Phase:", ctx.args.options.currentGroups)
              return next();
            } else {
              ctx.args.options.currentGroups = [];
              return next();
            }
          } else {
            // authorizedRoles can not be used for this, since roles depend on the ACLs used in a collection,
            // fetch roles via Rolemapping table instead
            RoleMapping.find({
              where: {
                principalId: String(
                  ctx.args.options.accessToken.userId
                )
              }
            },
            ctx.args.options,
            function (err, instances) {
              // map roleid to name
              const roleIdList = instances.map(
                instance => instance.roleId
              );
              Role.find({
                where: {
                  id: {
                    inq: roleIdList
                  }
                }
              },
              function (err, result) {
                if (err) return next(err);
                const roleNameList = result.map(
                  instance => instance.name
                );
                // add beamline specific account name as an additional role for beamline specific data
                roleNameList.push(user.username);
                ctx.args.options.currentGroups = roleNameList;
                // console.log("Current groups:",  ctx.args.options.currentGroups)
                return next();
              }
              );
            }
            );
          }
        }
        );
      });
    });

  // extend built in User model

  const User = app.models.User;

  User.userInfos = function (options, cb) {
    delete options.prohibitHiddenPropertiesInQuery;
    delete options.maxDepthOfQuery;
    delete options.maxDepthOfData;
    cb(null, options);
  };

  User.remoteMethod("userInfos", {
    accepts: [{
      arg: "options",
      type: "object",
      http: "optionsFromRequest"
    }],
    returns: {
      root: true
    },
    description: "Returns username, email , group membership etc for the user linked with the provided accessToken.",
    http: {
      path: "/userInfos",
      verb: "get"
    }
  });

  logger.logInfo("Adding relations to User", {
    relation: "UserSetting"
  });

  const UserSetting = app.models.UserSetting;

  User.hasOne(UserSetting, {
    foreignKey: "",
    as: "settings"
  });

  logger.logInfo("Adding ACLS for User related models", {
    relation: "UserSetting"
  });

  const userACLS = User.settings.acls;

  const userSettingsACLS = [{
    principalType: "ROLE",
    principalId: "$owner",
    permission: "ALLOW",
    property: [
      "__create__settings",
      "__get__settings",
      "__update__settings"
    ]
  },
  {
    principalType: "ROLE",
    principalId: "admin",
    permission: "ALLOW",
    property: [
      "__create__settings",
      "__get__settings",
      "__update__settings",
      "__destroy__settings"
    ]
  }
  ];

  User.settings.acls = userACLS.concat(userSettingsACLS);

  User.afterRemote("findById", function (ctx, user, next) {
    user.settings((err, settings) => {
      if (err) {
        logger.logError(err.message);
      } else if (!settings) {
        logger.logInfo("Adding default settings to user", {
          user
        });
        user.settings.create({
          columns: []
        });
      }
    });
    next();
  });

  const sanitazeUniqueness = require("./validations").sanitazeUniqueness;
  sanitazeUniqueness(app.models);

};
