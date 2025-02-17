#!/usr/bin/env bash

# script that (re-)installs backend with the most recent version on master

# Prerequisites:
# - helm and kubectl commands are installed
# - Git repositories backend, backend-psiconfig, backend-psisecrets are cheked out as master
#   into SCICAT_HOME  directory

# Usage ./deploy.sh ENVIRONMENT(production, staging, qa, development)


if [ "$#" -ne 1 ]; then
  echo "Command to re-install backend"
  echo "Usage ./deploy.sh ENVIRONMENT" >&2
  exit 1
fi

if [[ -z "${SCICAT_HOME}" ]]; then
    echo "SCICAT_HOME is not defined, you need to define it first, e.g."
    echo "export SCICAT_HOME=~egli/melanie/"
    exit 1
fi

#
if [[ -z "${KUBECONFIG}" ]]; then
    echo "KUBECONFIG is not defined, you need to define it first, e.g."
    echo "e.g. export KUBECONFIG=~egli/melanie/backend-psisecrets/server/kubernetes/admin.conf"
    exit 1
fi

export env=$1

# install secrets
# kubectl -n $env create secret generic loopback-mongo-secret --from-file=$SCICAT_HOME/backend-psisecrets/server/providers.json --from-file=$SCICAT_HOME/backend-psisecrets/server/pass-db-$env

# API server

# create docker image
cd $SCICAT_HOME/backend/
# git checkout master
# git pull
tag=$(git rev-parse HEAD )
sudo docker build --network=host -t registry.psi.ch:5000/egli/dacatapiserver:$tag .
sudo docker push registry.psi.ch:5000/egli/dacatapiserver:$tag

# install
cd $SCICAT_HOME/backend-psiconfig/server/kubernetes/helm/
helm del --purge dacat-api-server-${env}
helm install dacat-api-server --namespace=${env} --name=dacat-api-server-${env} --set image.tag=${tag}
